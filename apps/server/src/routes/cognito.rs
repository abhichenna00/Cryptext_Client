// src/routes/cognito.rs

use crate::{
    config::get_config,
    error::{AppError, AppResult},
};
use aws_sdk_cognitoidentityprovider::{
    types::{AttributeType, AuthFlowType},
    Client as CognitoClient,
};
use axum::extract::Json;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

// ============================================
// TYPES
// ============================================

#[derive(Deserialize)]
pub struct SignInRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct SignUpRequest {
    pub email: String,
    pub password: String,
    pub phone: Option<String>,
}

#[derive(Deserialize)]
pub struct ConfirmRequest {
    pub email: String,
    pub code: String,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
    pub username: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub success: bool,
    pub error: Option<String>,
    pub user_id: Option<String>,
    pub needs_confirmation: Option<bool>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub email: Option<String>,
    pub expires_at: Option<i64>,
}

// ============================================
// HELPERS
// ============================================

async fn cognito_client() -> CognitoClient {
    let config = get_config();
    let sdk_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(config.aws_region.clone()))
        .load()
        .await;
    CognitoClient::new(&sdk_config)
}

/// Compute the SECRET_HASH required for confidential app clients.
/// Hash = Base64(HMAC_SHA256(client_secret, username + client_id))
fn compute_secret_hash(username: &str) -> String {
    let config = get_config();
    let key = config.cognito_client_secret.as_bytes();
    let message = format!("{}{}", username, config.cognito_client_id);

    let mut mac = Hmac::<Sha256>::new_from_slice(key)
        .expect("HMAC can take key of any size");
    mac.update(message.as_bytes());
    let result = mac.finalize();

    base64::engine::general_purpose::STANDARD.encode(result.into_bytes())
}

fn decode_id_token(id_token: &str) -> (String, String) {
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        return (String::new(), String::new());
    }
    if let Ok(decoded) = URL_SAFE_NO_PAD.decode(parts[1]) {
        if let Ok(payload) = String::from_utf8(decoded) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&payload) {
                let user_id = json["sub"].as_str().unwrap_or_default().to_string();
                let email = json["email"].as_str().unwrap_or_default().to_string();
                return (user_id, email);
            }
        }
    }
    (String::new(), String::new())
}

fn error_response(msg: &str) -> AuthResponse {
    AuthResponse {
        success: false,
        error: Some(msg.to_string()),
        user_id: None,
        needs_confirmation: None,
        access_token: None,
        refresh_token: None,
        id_token: None,
        email: None,
        expires_at: None,
    }
}

/// Internal sign-in logic returning a plain AuthResponse (not wrapped in Json).
/// Used by both the sign_in handler and sign_up (for auto-confirmed users).
async fn sign_in_with_cognito(email: &str, password: &str) -> AppResult<AuthResponse> {
    let config = get_config();
    let client = cognito_client().await;
    let secret_hash = compute_secret_hash(email.trim());

    let result = client
        .initiate_auth()
        .auth_flow(AuthFlowType::UserPasswordAuth)
        .client_id(&config.cognito_client_id)
        .auth_parameters("USERNAME", email.trim())
        .auth_parameters("PASSWORD", password)
        .auth_parameters("SECRET_HASH", &secret_hash)
        .send()
        .await;

    match result {
        Ok(response) => {
            if let Some(auth_result) = response.authentication_result() {
                let access_token = auth_result.access_token().unwrap_or_default().to_string();
                let refresh_token = auth_result.refresh_token().unwrap_or_default().to_string();
                let id_token = auth_result.id_token().unwrap_or_default().to_string();
                let expires_in = auth_result.expires_in() as i64;
                let expires_at = chrono::Utc::now().timestamp() + expires_in;
                let (user_id, user_email) = decode_id_token(&id_token);

                Ok(AuthResponse {
                    success: true,
                    error: None,
                    user_id: Some(user_id),
                    needs_confirmation: Some(false),
                    access_token: Some(access_token),
                    refresh_token: Some(refresh_token),
                    id_token: Some(id_token),
                    email: Some(user_email),
                    expires_at: Some(expires_at),
                })
            } else {
                Ok(error_response("No authentication result"))
            }
        }
        Err(e) => {
            let msg = match e.into_service_error() {
                err if err.is_not_authorized_exception() => "Invalid email or password".to_string(),
                err if err.is_user_not_found_exception() => "User not found".to_string(),
                err if err.is_user_not_confirmed_exception() => {
                    return Ok(AuthResponse {
                        success: false,
                        error: Some("Please confirm your email first".to_string()),
                        user_id: None,
                        needs_confirmation: Some(true),
                        access_token: None,
                        refresh_token: None,
                        id_token: None,
                        email: None,
                        expires_at: None,
                    });
                }
                _ => "Authentication failed".to_string(),
            };
            Ok(error_response(&msg))
        }
    }
}

// ============================================
// HANDLERS
// ============================================

pub async fn sign_in(Json(req): Json<SignInRequest>) -> AppResult<Json<AuthResponse>> {
    if req.email.trim().is_empty() {
        return Ok(Json(error_response("Email is required")));
    }
    if req.password.is_empty() {
        return Ok(Json(error_response("Password is required")));
    }

    let response = sign_in_with_cognito(&req.email, &req.password).await?;
    Ok(Json(response))
}

pub async fn sign_up(Json(req): Json<SignUpRequest>) -> AppResult<Json<AuthResponse>> {
    if req.email.trim().is_empty() {
        return Ok(Json(error_response("Email is required")));
    }
    if req.password.len() < 8 {
        return Ok(Json(error_response("Password must be at least 8 characters")));
    }

    let config = get_config();
    let client = cognito_client().await;
    let secret_hash = compute_secret_hash(req.email.trim());

    let mut attributes = vec![
        AttributeType::builder()
            .name("email")
            .value(req.email.trim())
            .build()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    ];

    if let Some(ref phone) = req.phone {
        if !phone.trim().is_empty() {
            attributes.push(
                AttributeType::builder()
                    .name("phone_number")
                    .value(phone.trim())
                    .build()
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            );
        }
    }

    let result = client
        .sign_up()
        .client_id(&config.cognito_client_id)
        .secret_hash(&secret_hash)
        .username(req.email.trim())
        .password(&req.password)
        .set_user_attributes(Some(attributes))
        .send()
        .await;

    match result {
        Ok(response) => {
            let user_id = response.user_sub().to_string();
            let confirmed = response.user_confirmed();

            if confirmed {
                let sign_in_response = sign_in_with_cognito(&req.email, &req.password).await?;
                return Ok(Json(sign_in_response));
            }

            Ok(Json(AuthResponse {
                success: true,
                error: None,
                user_id: Some(user_id),
                needs_confirmation: Some(true),
                access_token: None,
                refresh_token: None,
                id_token: None,
                email: None,
                expires_at: None,
            }))
        }
        Err(e) => {
            let msg = match e.into_service_error() {
                err if err.is_username_exists_exception() => {
                    "An account with this email already exists".to_string()
                }
                err if err.is_invalid_password_exception() => {
                    "Password does not meet requirements".to_string()
                }
                err if err.is_invalid_parameter_exception() => {
                    err.meta().message().unwrap_or("Invalid parameter").to_string()
                }
                err => format!("Signup failed: {:?}", err),
            };
            Ok(Json(error_response(&msg)))
        }
    }
}

pub async fn confirm_sign_up(Json(req): Json<ConfirmRequest>) -> AppResult<Json<AuthResponse>> {
    if req.email.trim().is_empty() || req.code.trim().is_empty() {
        return Ok(Json(error_response("Email and code are required")));
    }

    let config = get_config();
    let client = cognito_client().await;
    let secret_hash = compute_secret_hash(req.email.trim());

    let result = client
        .confirm_sign_up()
        .client_id(&config.cognito_client_id)
        .secret_hash(&secret_hash)
        .username(req.email.trim())
        .confirmation_code(req.code.trim())
        .send()
        .await;

    match result {
        Ok(_) => Ok(Json(AuthResponse {
            success: true,
            error: None,
            user_id: None,
            needs_confirmation: Some(false),
            access_token: None,
            refresh_token: None,
            id_token: None,
            email: None,
            expires_at: None,
        })),
        Err(e) => {
            let msg = match e.into_service_error() {
                err if err.is_code_mismatch_exception() => "Invalid verification code".to_string(),
                err if err.is_expired_code_exception() => "Verification code has expired".to_string(),
                _ => "Confirmation failed".to_string(),
            };
            Ok(Json(error_response(&msg)))
        }
    }
}

pub async fn refresh_token(Json(req): Json<RefreshRequest>) -> AppResult<Json<AuthResponse>> {
    if req.refresh_token.is_empty() {
        return Ok(Json(error_response("Refresh token is required")));
    }
    if req.username.is_empty() {
        return Ok(Json(error_response("Username is required")));
    }

    let config = get_config();
    let client = cognito_client().await;
    let secret_hash = compute_secret_hash(&req.username);

    let result = client
        .initiate_auth()
        .auth_flow(AuthFlowType::RefreshTokenAuth)
        .client_id(&config.cognito_client_id)
        .auth_parameters("REFRESH_TOKEN", &req.refresh_token)
        .auth_parameters("SECRET_HASH", &secret_hash)
        .send()
        .await;

    match result {
        Ok(response) => {
            if let Some(auth_result) = response.authentication_result() {
                let access_token = auth_result.access_token().unwrap_or_default().to_string();
                let id_token = auth_result.id_token().unwrap_or_default().to_string();
                let expires_in = auth_result.expires_in() as i64;
                let expires_at = chrono::Utc::now().timestamp() + expires_in;
                let (user_id, email) = decode_id_token(&id_token);

                Ok(Json(AuthResponse {
                    success: true,
                    error: None,
                    user_id: Some(user_id),
                    needs_confirmation: None,
                    access_token: Some(access_token),
                    refresh_token: None,
                    id_token: Some(id_token),
                    email: Some(email),
                    expires_at: Some(expires_at),
                }))
            } else {
                Ok(Json(error_response("No authentication result")))
            }
        }
        Err(_) => Ok(Json(error_response("Session expired, please sign in again"))),
    }
}