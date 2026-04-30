use crate::{config::get_config, error::AppError, redis::get_redis};
use axum::{
    extract::Query,
    response::Html,
    Json,
};
use redis::{AsyncCommands, ExistenceCheck, SetExpiry, SetOptions};
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
    pub code: Option<String>,
    pub state: String,
    pub error: Option<String>,
    pub error_description: Option<String>,
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
    format!("oauth:entra:{}", state_id)
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

/// Conditional write — only succeeds if the key already exists. Used in the
/// callback so a TTL-expired state cannot be silently resurrected, and races
/// with concurrent callbacks land predictably on whichever write hit Redis last.
async fn update_auth_status_xx(state_id: &str, status: &AuthStatus) -> Result<bool, AppError> {
    let mut conn = get_redis();
    let json = serde_json::to_string(status)
        .map_err(|e| AppError::Internal(format!("Failed to serialize auth status: {}", e)))?;
    let opts = SetOptions::default()
        .conditional_set(ExistenceCheck::XX)
        .with_expiration(SetExpiry::EX(OAUTH_STATE_TTL_SECS));
    let result: redis::Value = conn
        .set_options(&oauth_key(state_id), json, opts)
        .await
        .map_err(|e| AppError::Internal(format!("Redis error: {}", e)))?;
    Ok(matches!(result, redis::Value::Okay))
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

/// POST /auth/entra/start
/// Called by the Tauri client. Generates a state ID and returns the Cognito authorize URL.
pub async fn start_entra_auth() -> Result<Json<StartResponse>, AppError> {
    let config = get_config();
    let state_id = Uuid::new_v4().to_string();

    set_auth_status(&state_id, &AuthStatus::Pending).await?;

    let authorize_url = format!(
        "https://{}/oauth2/authorize?response_type=code&client_id={}&redirect_uri={}&state={}&scope=openid+email+profile&identity_provider={}&prompt=select_account",
        config.cognito_domain,
        config.cognito_client_id,
        urlencoding::encode(&config.entra_redirect_uri),
        state_id,
        config.entra_provider_name,
    );

    tracing::debug!("Entra OAuth started with state: {}", state_id);

    Ok(Json(StartResponse {
        authorize_url,
        state: state_id,
    }))
}

/// GET /auth/entra/callback?code=xxx&state=xxx
/// Cognito redirects here after the user signs in via Entra.
pub async fn entra_callback(
    Query(params): Query<CallbackParams>,
) -> Html<String> {
    // Cognito surfaces IdP failures (consent denial, MFA cancel, IdP misconfig)
    // as ?error=...&error_description=... rather than returning a code.
    if let Some(err) = params.error.as_ref() {
        let reason = params
            .error_description
            .clone()
            .unwrap_or_else(|| err.clone());
        tracing::warn!("Entra OAuth callback error: {} ({})", err, reason);

        let _ = update_auth_status_xx(
            &params.state,
            &AuthStatus::Failed {
                error: format!("Microsoft sign-in failed: {}", reason),
            },
        )
        .await;

        return failure_page();
    }

    let existing = match get_auth_status(&params.state).await {
        Ok(s) => s,
        Err(_) => return failure_page(),
    };

    match existing {
        Some(AuthStatus::Pending) => {}
        _ => {
            return Html(
                "<html><body><h1>Invalid or expired session</h1>\
                <p>Please try signing in again from Cryptext.</p></body></html>"
                    .to_string(),
            );
        }
    }

    let code = match params.code.as_deref() {
        Some(c) if !c.is_empty() => c,
        _ => {
            let _ = update_auth_status_xx(
                &params.state,
                &AuthStatus::Failed {
                    error: "Microsoft sign-in failed: missing authorization code.".to_string(),
                },
            )
            .await;
            return failure_page();
        }
    };

    match exchange_code_for_tokens(code).await {
        Ok(tokens) => {
            let _ = update_auth_status_xx(
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
            tracing::error!("Entra OAuth token exchange failed: {}", e);

            let _ = update_auth_status_xx(
                &params.state,
                &AuthStatus::Failed {
                    error: "Microsoft sign-in failed. Please try again.".to_string(),
                },
            )
            .await;

            failure_page()
        }
    }
}

fn failure_page() -> Html<String> {
    Html(
        "<html><body style=\"font-family: sans-serif; text-align: center; padding-top: 80px;\">\
            <h1>Sign-in failed</h1>\
            <p>Something went wrong. Please try again from Cryptext.</p>\
        </body></html>"
            .to_string(),
    )
}

/// GET /auth/entra/status?state=xxx
/// The Tauri client polls this to check if the OAuth flow completed.
pub async fn entra_auth_status(
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
            ("redirect_uri", &config.entra_redirect_uri),
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
