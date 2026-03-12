use crate::{config::get_config, error::AppError};
use axum::{
    extract::Query,
    response::Html,
    Json,
};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;
use uuid::Uuid;
use base64::Engine;

// ── Pending auth store (same pattern as JWKS_CACHE in auth.rs) ──

static PENDING_AUTHS: OnceCell<RwLock<HashMap<String, AuthStatus>>> = OnceCell::new();

fn pending_auths() -> &'static RwLock<HashMap<String, AuthStatus>> {
    PENDING_AUTHS.get_or_init(|| RwLock::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize)]
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

// ── Route handlers ──

/// POST /auth/google/start
/// Called by the Tauri client. Generates a state ID and returns the Cognito authorize URL.
pub async fn start_google_auth() -> Result<Json<StartResponse>, AppError> {
    let config = get_config();
    let state_id = Uuid::new_v4().to_string();

    pending_auths()
        .write()
        .await
        .insert(state_id.clone(), AuthStatus::Pending);

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
    let exists = {
        let store = pending_auths().read().await;
        store.contains_key(&params.state)
    };

    if !exists {
        return Html(
            "<html><body><h1>Invalid or expired session</h1>\
            <p>Please try signing in again from Cryptext.</p></body></html>"
                .to_string(),
        );
    }

    match exchange_code_for_tokens(&params.code).await {
        Ok(tokens) => {
            pending_auths().write().await.insert(
                params.state,
                AuthStatus::Complete {
                    id_token: tokens.id_token,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                },
            );

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

            pending_auths().write().await.insert(
                params.state,
                AuthStatus::Failed {
                    error: e.to_string(),
                },
            );

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
    let store = pending_auths().read().await;

    match store.get(&params.state) {
        Some(status) => {
            let status = status.clone();
            drop(store);

            // Clean up completed/failed entries so they don't pile up
            match &status {
                AuthStatus::Complete { .. } | AuthStatus::Failed { .. } => {
                    pending_auths().write().await.remove(&params.state);
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
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        tracing::error!("Cognito token exchange failed ({}): {}", status, body);
        return Err(AppError::Internal(format!(
            "Token exchange failed ({}): {}",
            status, body
        )));
    }

    response
        .json::<CognitoTokenResponse>()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse token response: {}", e)))
}