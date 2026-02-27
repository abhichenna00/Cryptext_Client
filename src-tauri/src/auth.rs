// src-tauri/src/auth.rs

use crate::http_client;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{command, State};

/// Represents a user session stored securely in Tauri's backend process
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub user_id: String,
    pub email: String,
    pub expires_at: i64,
}

/// Thread-safe session storage (managed by Tauri)
pub struct SessionStore {
    pub session: Mutex<Option<Session>>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }
}

/// Public session info returned to frontend (no sensitive tokens)
#[derive(Serialize)]
pub struct PublicSessionInfo {
    pub user_id: String,
    pub email: String,
    pub is_authenticated: bool,
}

/// Result returned to frontend for auth operations
#[derive(Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    pub error: Option<String>,
    pub user_id: Option<String>,
    pub needs_confirmation: bool,
}

/// Response shape returned by the Axum auth endpoints
#[derive(Deserialize)]
struct ServerAuthResponse {
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

#[derive(Serialize)]
struct SignInBody {
    email: String,
    password: String,
}

#[derive(Serialize)]
struct SignUpBody {
    email: String,
    password: String,
    phone: Option<String>,
}

#[derive(Serialize)]
struct ConfirmBody {
    email: String,
    code: String,
}

#[derive(Serialize)]
struct RefreshBody {
    refresh_token: String,
}

/// Sign in with email and password via the Axum server
#[command]
pub async fn sign_in(
    email: String,
    password: String,
    session_store: State<'_, SessionStore>,
) -> Result<AuthResult, String> {
    if email.trim().is_empty() {
        return Ok(AuthResult {
            success: false,
            error: Some("Email is required".to_string()),
            user_id: None,
            needs_confirmation: false,
        });
    }

    if password.is_empty() {
        return Ok(AuthResult {
            success: false,
            error: Some("Password is required".to_string()),
            user_id: None,
            needs_confirmation: false,
        });
    }

    let body = SignInBody { email, password };
    let response: ServerAuthResponse = http_client::post_no_auth("/auth/signin", &body).await?;

    if response.success {
        // Store the session in Tauri's backend process
        if let (Some(access_token), Some(refresh_token), Some(id_token), Some(user_id), Some(email), Some(expires_at)) = (
            response.access_token,
            response.refresh_token,
            response.id_token,
            response.user_id.clone(),
            response.email,
            response.expires_at,
        ) {
            let session = Session {
                access_token,
                refresh_token,
                id_token,
                user_id: user_id.clone(),
                email,
                expires_at,
            };
            let mut store = session_store.session.lock().map_err(|e| e.to_string())?;
            *store = Some(session);

            Ok(AuthResult {
                success: true,
                error: None,
                user_id: Some(user_id),
                needs_confirmation: false,
            })
        } else {
            Ok(AuthResult {
                success: false,
                error: Some("Invalid response from server".to_string()),
                user_id: None,
                needs_confirmation: false,
            })
        }
    } else {
        Ok(AuthResult {
            success: false,
            error: response.error,
            user_id: None,
            needs_confirmation: response.needs_confirmation.unwrap_or(false),
        })
    }
}

/// Sign up with email and password via the Axum server
#[command]
pub async fn sign_up(
    email: String,
    password: String,
    phone: Option<String>,
    session_store: State<'_, SessionStore>,
) -> Result<AuthResult, String> {
    if email.trim().is_empty() {
        return Ok(AuthResult {
            success: false,
            error: Some("Email is required".to_string()),
            user_id: None,
            needs_confirmation: false,
        });
    }

    if password.len() < 8 {
        return Ok(AuthResult {
            success: false,
            error: Some("Password must be at least 8 characters".to_string()),
            user_id: None,
            needs_confirmation: false,
        });
    }

    let body = SignUpBody { email: email.clone(), password: password.clone(), phone };
    let response: ServerAuthResponse = http_client::post_no_auth("/auth/signup", &body).await?;

    if response.success {
        let needs_confirmation = response.needs_confirmation.unwrap_or(false);

        if !needs_confirmation {
            // Auto-confirmed — server may have returned tokens directly, or we sign in
            if response.access_token.is_some() {
                if let (Some(access_token), Some(refresh_token), Some(id_token), Some(user_id), Some(email), Some(expires_at)) = (
                    response.access_token,
                    response.refresh_token,
                    response.id_token,
                    response.user_id.clone(),
                    response.email,
                    response.expires_at,
                ) {
                    let session = Session { access_token, refresh_token, id_token, user_id: user_id.clone(), email, expires_at };
                    let mut store = session_store.session.lock().map_err(|e| e.to_string())?;
                    *store = Some(session);
                    return Ok(AuthResult { success: true, error: None, user_id: Some(user_id), needs_confirmation: false });
                }
            }
            // Fallback: do a sign-in
            return sign_in(email, password, session_store).await;
        }

        Ok(AuthResult {
            success: true,
            error: None,
            user_id: response.user_id,
            needs_confirmation: true,
        })
    } else {
        Ok(AuthResult {
            success: false,
            error: response.error,
            user_id: None,
            needs_confirmation: false,
        })
    }
}

/// Confirm signup with verification code
#[command]
pub async fn confirm_sign_up(
    email: String,
    code: String,
) -> Result<AuthResult, String> {
    let body = ConfirmBody { email, code };
    let response: ServerAuthResponse = http_client::post_no_auth("/auth/confirm", &body).await?;

    Ok(AuthResult {
        success: response.success,
        error: response.error,
        user_id: None,
        needs_confirmation: !response.success,
    })
}

/// Sign out and clear the local session
#[command]
pub async fn sign_out(session_store: State<'_, SessionStore>) -> Result<bool, String> {
    let mut store = session_store.session.lock().map_err(|e| e.to_string())?;
    *store = None;
    Ok(true)
}

/// Get current public session info (no tokens exposed)
#[command]
pub async fn get_session(
    session_store: State<'_, SessionStore>,
) -> Result<Option<PublicSessionInfo>, String> {
    let store = session_store.session.lock().map_err(|e| e.to_string())?;

    match &*store {
        Some(session) if chrono::Utc::now().timestamp() < session.expires_at => {
            Ok(Some(PublicSessionInfo {
                user_id: session.user_id.clone(),
                email: session.email.clone(),
                is_authenticated: true,
            }))
        }
        _ => Ok(None),
    }
}

/// Get the access token for internal use (Tauri commands only, not exposed to frontend ideally)
#[command]
pub async fn get_auth_token(
    session_store: State<'_, SessionStore>,
) -> Result<Option<String>, String> {
    let store = session_store.session.lock().map_err(|e| e.to_string())?;

    match &*store {
        Some(session) if chrono::Utc::now().timestamp() < session.expires_at => {
            Ok(Some(session.access_token.clone()))
        }
        _ => Ok(None),
    }
}

/// Get user ID from the current session
#[command]
pub async fn get_user_id(
    session_store: State<'_, SessionStore>,
) -> Result<Option<String>, String> {
    let store = session_store.session.lock().map_err(|e| e.to_string())?;

    match &*store {
        Some(session) if chrono::Utc::now().timestamp() < session.expires_at => {
            Ok(Some(session.user_id.clone()))
        }
        _ => Ok(None),
    }
}

/// Refresh the session using the refresh token
#[command]
pub async fn refresh_session(session_store: State<'_, SessionStore>) -> Result<bool, String> {
    let refresh_token = {
        let store = session_store.session.lock().map_err(|e| e.to_string())?;
        match &*store {
            Some(session) => session.refresh_token.clone(),
            None => return Ok(false),
        }
    };

    let body = RefreshBody { refresh_token };
    let response: ServerAuthResponse = match http_client::post_no_auth("/auth/refresh", &body).await {
        Ok(r) => r,
        Err(_) => {
            // If refresh fails, clear the session
            let mut store = session_store.session.lock().map_err(|e| e.to_string())?;
            *store = None;
            return Ok(false);
        }
    };

    if response.success {
        if let (Some(access_token), Some(id_token), Some(user_id), Some(email), Some(expires_at)) = (
            response.access_token,
            response.id_token,
            response.user_id,
            response.email,
            response.expires_at,
        ) {
            let mut store = session_store.session.lock().map_err(|e| e.to_string())?;
            if let Some(session) = store.as_mut() {
                session.access_token = access_token;
                session.id_token = id_token;
                session.user_id = user_id;
                session.email = email;
                session.expires_at = expires_at;
            }
            Ok(true)
        } else {
            Ok(false)
        }
    } else {
        let mut store = session_store.session.lock().map_err(|e| e.to_string())?;
        *store = None;
        Ok(false)
    }
}

/// Sync OAuth session (for Google sign-in — future use)
#[command]
pub async fn sync_oauth_session(
    access_token: String,
    refresh_token: String,
    id_token: String,
    user_id: String,
    email: String,
    expires_at: i64,
    session_store: State<'_, SessionStore>,
) -> Result<bool, String> {
    if access_token.is_empty() {
        return Err("Access token is required".to_string());
    }
    if user_id.is_empty() {
        return Err("User ID is required".to_string());
    }

    let session = Session { access_token, refresh_token, id_token, user_id, email, expires_at };
    let mut store = session_store.session.lock().map_err(|e| e.to_string())?;
    *store = Some(session);
    Ok(true)
}

/// Get WebSocket URL for realtime connections
#[tauri::command]
pub async fn get_websocket_url() -> Result<String, String> {
    crate::config::websocket_url().await
}