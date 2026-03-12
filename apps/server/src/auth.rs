use crate::{config::get_config, error::AppError};
use axum::{
    extract::FromRequestParts,
    http::{request::Parts, HeaderMap},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

static JWKS_CACHE: OnceCell<tokio::sync::RwLock<JwksCache>> = OnceCell::new();

#[derive(Debug, Clone)]
struct JwksCache {
    keys: HashMap<String, JwkKey>,
}

#[derive(Debug, Clone, Deserialize)]
struct JwkKey {
    kid: String,
    n: String,
    e: String,
}

#[derive(Debug, Clone, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

/// The validated JWT claims extracted from the Cognito token
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,       // user_id
    pub email: Option<String>,
    pub exp: i64,
    pub iat: i64,
    pub token_use: Option<String>,
}

impl Claims {
    pub fn user_id(&self) -> &str {
        &self.sub
    }
}

/// Axum extractor — pulls the Bearer token from Authorization header,
/// validates it against Cognito JWKS, and returns Claims
#[axum::async_trait]
impl<S> FromRequestParts<S> for Claims
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let token = extract_bearer_token(&parts.headers)?;
        validate_token(&token).await
    }
}

fn extract_bearer_token(headers: &HeaderMap) -> Result<String, AppError> {
    let auth_header = headers
        .get("Authorization")
        .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?
        .to_str()
        .map_err(|_| AppError::Unauthorized("Invalid Authorization header".to_string()))?;

    if !auth_header.starts_with("Bearer ") {
        return Err(AppError::Unauthorized(
            "Authorization header must be Bearer token".to_string(),
        ));
    }

    Ok(auth_header[7..].to_string())
}

async fn validate_token(token: &str) -> Result<Claims, AppError> {
    // 1. Decode header to get kid
    let header = decode_jwt_header(token)?;
    let kid = header["kid"]
        .as_str()
        .ok_or_else(|| AppError::Unauthorized("Token missing kid".to_string()))?
        .to_string();

    // 2. Get JWKS (cached)
    let jwks = get_jwks().await?;
    let key = jwks.get(&kid).ok_or_else(|| {
        AppError::Unauthorized("Token signed with unknown key".to_string())
    })?;

    // 3. Decode and verify claims (expiry, token_use)
    let claims = decode_jwt_claims(token)?;

    // Verify expiry
    let now = chrono::Utc::now().timestamp();
    if claims.exp < now {
        return Err(AppError::Unauthorized("Token has expired".to_string()));
    }

    // Verify token_use is "access"
    if let Some(ref token_use) = claims.token_use {
        if token_use != "access" {
            return Err(AppError::Unauthorized(
                "Token must be an access token".to_string(),
            ));
        }
    }

    // 4. Verify signature using RSA public key
    verify_rsa_signature(token, &key.n, &key.e)?;

    Ok(claims)
}

fn decode_jwt_header(token: &str) -> Result<Value, AppError> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(AppError::Unauthorized("Invalid JWT format".to_string()));
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(parts[0])
        .map_err(|_| AppError::Unauthorized("Failed to decode JWT header".to_string()))?;
    serde_json::from_slice(&decoded)
        .map_err(|_| AppError::Unauthorized("Failed to parse JWT header".to_string()))
}

fn decode_jwt_claims(token: &str) -> Result<Claims, AppError> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(AppError::Unauthorized("Invalid JWT format".to_string()));
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| AppError::Unauthorized("Failed to decode JWT claims".to_string()))?;
    serde_json::from_slice(&decoded)
        .map_err(|_| AppError::Unauthorized("Failed to parse JWT claims".to_string()))
}

fn verify_rsa_signature(token: &str, n: &str, e: &str) -> Result<(), AppError> {
    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};

    let n_bytes = URL_SAFE_NO_PAD
        .decode(n)
        .map_err(|_| AppError::Unauthorized("Invalid JWK n parameter".to_string()))?;
    let e_bytes = URL_SAFE_NO_PAD
        .decode(e)
        .map_err(|_| AppError::Unauthorized("Invalid JWK e parameter".to_string()))?;

    let decoding_key = DecodingKey::from_rsa_raw_components(&n_bytes, &e_bytes);

    let config = get_config();
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[format!(
        "https://cognito-idp.{}.amazonaws.com/{}",
        config.aws_region, config.cognito_user_pool_id
    )]);
    validation.set_audience(&[&config.cognito_client_id]);

    decode::<Claims>(token, &decoding_key, &validation)
        .map_err(|e| AppError::Unauthorized(format!("Token validation failed: {}", e)))?;

    Ok(())
}

async fn get_jwks() -> Result<HashMap<String, JwkKey>, AppError> {
    let cache_lock = JWKS_CACHE.get_or_init(|| {
        tokio::sync::RwLock::new(JwksCache {
            keys: HashMap::new(),
        })
    });

    // Try read first (fast path)
    {
        let cache = cache_lock.read().await;
        if !cache.keys.is_empty() {
            return Ok(cache.keys.clone());
        }
    }

    // Fetch fresh JWKS
    let config = get_config();
    let jwks_url = format!(
        "https://cognito-idp.{}.amazonaws.com/{}/.well-known/jwks.json",
        config.aws_region, config.cognito_user_pool_id
    );

    tracing::info!("Fetching JWKS from: {}", jwks_url);

    let response = reqwest::get(&jwks_url)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch JWKS: {}", e)))?
        .json::<JwksResponse>()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse JWKS: {}", e)))?;

    let keys: HashMap<String, JwkKey> = response
        .keys
        .into_iter()
        .map(|k| (k.kid.clone(), k))
        .collect();

    // Write to cache
    let mut cache = cache_lock.write().await;
    cache.keys = keys.clone();

    Ok(keys)
}
