use crate::{config::get_config, error::AppError, redis::get_redis};
use axum::{
    extract::Query,
    response::Html,
    Json,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use base64::Engine;

// OAuth state TTL: 5 minutes
const OAUTH_STATE_TTL_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum AuthStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "complete")]
    Complete {
        id_token: String,
        access_token: String,
        refresh_token: Option<String>,
    },
    #[serde(rename = "failed")]
    Failed { error: String },
}

// ── Request/Response types ──

#[derive(Serialize)]
pub struct StartResponse {
    pub authorize_url: String,
    pub state: String,
}

#[derive(Deserialize)]
pub struct CallbackParams {
    pub code: String,
    pub state: String,
}

#[derive(Deserialize)]
pub struct StatusParams {
    pub state: String,
}

#[derive(Deserialize)]
struct CognitoTokenResponse {
    id_token: String,
    access_token: String,
    refresh_token: Option<String>,
}

// ── Redis helpers ──

fn oauth_key(state_id: &str) -> String {
    format!("oauth:{}", state_id)
}

async fn set_auth_status(state_id: &str, status: &AuthStatus) -> Result<(), AppError> {
    let mut conn = get_redis();
    let json = serde_json::to_string(status)
        .map_err(|e| AppError::Internal(format!("Failed to serialize auth status: {}", e)))?;
    conn.set_ex::<_, _, ()>(&oauth_key(state_id), json, OAUTH_STATE_TTL_SECS)
        .await
        .map_err(|e| AppError::Internal(format!("Redis error: {}", e)))?;
    Ok(())
}

async fn get_auth_status(state_id: &str) -> Result<Option<AuthStatus>, AppError> {
    let mut conn = get_redis();
    let result: Option<String> = conn
        .get(&oauth_key(state_id))
        .await
        .map_err(|e| AppError::Internal(format!("Redis error: {}", e)))?;

    match result {
        Some(json) => {
            let status: AuthStatus = serde_json::from_str(&json)
                .map_err(|e| AppError::Internal(format!("Failed to parse auth status: {}", e)))?;
            Ok(Some(status))
        }
        None => Ok(None),
    }
}

async fn delete_auth_status(state_id: &str) -> Result<(), AppError> {
    let mut conn = get_redis();
    conn.del::<_, ()>(&oauth_key(state_id))
        .await
        .map_err(|e| AppError::Internal(format!("Redis error: {}", e)))?;
    Ok(())
}

// ── Route handlers ──

/// POST /auth/google/start
/// Called by the Tauri client. Generates a state ID and returns the Cognito authorize URL.
pub async fn start_google_auth() -> Result<Json<StartResponse>, AppError> {
    let config = get_config();
    let state_id = Uuid::new_v4().to_string();

    set_auth_status(&state_id, &AuthStatus::Pending).await?;

    let authorize_url = format!(
        "https://{}/oauth2/authorize?response_type=code&client_id={}&redirect_uri={}&state={}&scope=openid+email+profile&identity_provider=Google&prompt=select_account",
        config.cognito_domain,
        config.cognito_client_id,
        urlencoding::encode(&config.google_redirect_uri),
        state_id
    );

    tracing::info!("Google OAuth started with state: {}", state_id);

    Ok(Json(StartResponse {
        authorize_url,
        state: state_id,
    }))
}

/// GET /auth/google/callback?code=xxx&state=xxx
/// Cognito redirects here after the user signs in with Google.
pub async fn google_callback(
    Query(params): Query<CallbackParams>,
) -> Html<String> {
    let exists = get_auth_status(&params.state).await.ok().flatten().is_some();

    if !exists {
        return Html(
            "<html><body><h1>Invalid or expired session</h1>\
            <p>Please try signing in again from Cryptext.</p></body></html>"
                .to_string(),
        );
    }

    match exchange_code_for_tokens(&params.code).await {
        Ok(tokens) => {
            let _ = set_auth_status(
                &params.state,
                &AuthStatus::Complete {
                    id_token: tokens.id_token,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                },
            )
            .await;

            Html(
                "<html><body style=\"font-family: sans-serif; text-align: center; padding-top: 80px;\">\
                    <h1>Signed in successfully</h1>\
                    <p>You can close this tab and return to Cryptext.</p>\
                </body></html>"
                    .to_string(),
            )
        }
        Err(e) => {
            tracing::error!("Google OAuth token exchange failed: {}", e);

            let _ = set_auth_status(
                &params.state,
                &AuthStatus::Failed {
                    error: "Google sign-in failed. Please try again.".to_string(),
                },
            )
            .await;

            Html(
                "<html><body style=\"font-family: sans-serif; text-align: center; padding-top: 80px;\">\
                    <h1>Sign-in failed</h1>\
                    <p>Something went wrong. Please try again from Cryptext.</p>\
                </body></html>"
                    .to_string(),
            )
        }
    }
}

/// GET /auth/google/status?state=xxx
/// The Tauri client polls this to check if the OAuth flow completed.
pub async fn google_auth_status(
    Query(params): Query<StatusParams>,
) -> Result<Json<AuthStatus>, AppError> {
    match get_auth_status(&params.state).await? {
        Some(status) => {
            // Clean up completed/failed entries
            match &status {
                AuthStatus::Complete { .. } | AuthStatus::Failed { .. } => {
                    let _ = delete_auth_status(&params.state).await;
                }
                _ => {}
            }

            Ok(Json(status))
        }
        None => Err(AppError::Unauthorized(
            "Unknown or expired state parameter".to_string(),
        )),
    }
}

// ── Token exchange ──

async fn exchange_code_for_tokens(code: &str) -> Result<CognitoTokenResponse, AppError> {
    let config = get_config();
    let token_url = format!("https://{}/oauth2/token", config.cognito_domain);

    // Cognito expects HTTP Basic auth: base64(client_id:client_secret)
    let credentials = base64::engine::general_purpose::STANDARD.encode(format!(
        "{}:{}",
        config.cognito_client_id, config.cognito_client_secret
    ));

    let client = reqwest::Client::new();
    let response = client
        .post(&token_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Authorization", format!("Basic {}", credentials))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &config.google_redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to call Cognito token endpoint: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        // Body may contain Cognito-reflected user identifiers or other PII.
        // Keep it at DEBUG (off by default in prod) and strip it from
        // structured error messages that land in INFO/ERROR logs.
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::new());
        tracing::error!("Cognito token exchange failed: status {}", status);
        tracing::debug!(status = %status, body = %body, "token exchange body");
        return Err(AppError::Internal(format!(
            "Token exchange failed (status {})",
            status
        )));
    }

    response
        .json::<CognitoTokenResponse>()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse token response: {}", e)))
}
