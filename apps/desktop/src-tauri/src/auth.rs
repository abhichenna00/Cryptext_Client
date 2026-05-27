// src-tauri/src/auth.rs

use crate::http_client::HttpClient;
use crate::sync_utils::MutexExt;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{command, State};
use tauri_plugin_opener::OpenerExt;
use base64::Engine;

/// Buffer (in seconds) subtracted from token expiry to guard against clock skew
/// between the client and server.
const EXPIRY_BUFFER_SECS: i64 = 60;

/// Identity provider that produced the current session. Drives UX branches
/// like the enterprise profile prefill — federated sign-ins carry richer
/// identity claims that the new-user form can pre-fill from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum AuthProvider {
    #[default]
    Password,
    Google,
    Entra,
}

/// Represents a user session stored securely in Tauri's backend process
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub user_id: String,
    pub email: String,
    pub expires_at: i64,
    pub auth_provider: AuthProvider,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub name: Option<String>,
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

/// Extract auth token from session. Used by all modules that make authenticated API calls.
pub fn get_token(session_store: &State<'_, SessionStore>) -> Result<String, String> {
    let store = session_store.session.lock_or_err()?;
    match &*store {
        Some(session) if chrono::Utc::now().timestamp() + EXPIRY_BUFFER_SECS < session.expires_at => {
            Ok(session.access_token.clone())
        }
        Some(_) => Err("Session expired".to_string()),
        None => Err("Not authenticated".to_string()),
    }
}

/// Extract user_id from session. Used by modules that need the current user's identity.
pub fn get_user_id_from_session(session_store: &State<'_, SessionStore>) -> Result<String, String> {
    let store = session_store.session.lock_or_err()?;
    match &*store {
        Some(session) => Ok(session.user_id.clone()),
        None => Err("Not authenticated".to_string()),
    }
}

/// Public session info returned to frontend (no sensitive tokens)
#[derive(Serialize)]
pub struct PublicSessionInfo {
    pub user_id: String,
    pub email: String,
    pub is_authenticated: bool,
    pub is_enterprise: bool,
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
    username: String,
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
    let client = HttpClient::new();
    let response: ServerAuthResponse = client.post("/auth/signin", &body).await?;

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
                auth_provider: AuthProvider::Password,
                given_name: None,
                family_name: None,
                name: None,
            };
            let mut store = session_store.session.lock_or_err()?;
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
    let client = HttpClient::new();
    let response: ServerAuthResponse = client.post("/auth/signup", &body).await?;

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
                    let session = Session {
                        access_token,
                        refresh_token,
                        id_token,
                        user_id: user_id.clone(),
                        email,
                        expires_at,
                        auth_provider: AuthProvider::Password,
                        given_name: None,
                        family_name: None,
                        name: None,
                    };
                    let mut store = session_store.session.lock_or_err()?;
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
    let client = HttpClient::new();
    let response: ServerAuthResponse = client.post("/auth/confirm", &body).await?;

    Ok(AuthResult {
        success: response.success,
        error: response.error,
        user_id: None,
        needs_confirmation: !response.success,
    })
}

/// Sign out and clear the local session.
/// Also wipes the in-memory DEK and closes the encrypted DB so the vault
/// is no longer accessible in-process until the next unlock.
#[command]
pub async fn sign_out(
    session_store: State<'_, SessionStore>,
    local_db: State<'_, crate::local_db::LocalDb>,
) -> Result<bool, String> {
    let mut store = session_store.session.lock_or_err()?;
    *store = None;
    drop(store);
    let _ = crate::local_db::clear_vault_state(&local_db);
    Ok(true)
}

/// Get current public session info (no tokens exposed)
#[command]
pub async fn get_session(
    session_store: State<'_, SessionStore>,
) -> Result<Option<PublicSessionInfo>, String> {
    let store = session_store.session.lock_or_err()?;

    match &*store {
        Some(session) if chrono::Utc::now().timestamp() + EXPIRY_BUFFER_SECS < session.expires_at => {
            Ok(Some(PublicSessionInfo {
                user_id: session.user_id.clone(),
                email: session.email.clone(),
                is_authenticated: true,
                is_enterprise: session.auth_provider == AuthProvider::Entra,
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
    let store = session_store.session.lock_or_err()?;

    match &*store {
        Some(session) if chrono::Utc::now().timestamp() + EXPIRY_BUFFER_SECS < session.expires_at => {
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
    let store = session_store.session.lock_or_err()?;

    match &*store {
        Some(session) if chrono::Utc::now().timestamp() + EXPIRY_BUFFER_SECS < session.expires_at => {
            Ok(Some(session.user_id.clone()))
        }
        _ => Ok(None),
    }
}

/// Refresh the session using the refresh token
#[command]
pub async fn refresh_session(session_store: State<'_, SessionStore>) -> Result<bool, String> {
    let (refresh_token, user_id) = {
        let store = session_store.session.lock_or_err()?;
        match &*store {
            Some(session) => (session.refresh_token.clone(), session.user_id.clone()),
            None => return Ok(false),
        }
    };

    let body = RefreshBody {
        refresh_token,
        username: user_id,
    };
    let client = HttpClient::new();
    let response: ServerAuthResponse = match client.post("/auth/refresh", &body).await {
        Ok(r) => r,
        Err(e) => {
            // Only clear session on definitive auth failures, not transient errors
            if e.contains("401") || e.contains("403") {
                let mut store = session_store.session.lock_or_err()?;
                *store = None;
            }
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
            // Re-decode claims so federated identity fields stay accurate
            // across token refreshes.
            let refreshed_claims = decode_id_token_claims(&id_token).ok();
            let mut store = session_store.session.lock_or_err()?;
            if let Some(session) = store.as_mut() {
                session.access_token = access_token;
                session.id_token = id_token;
                session.user_id = user_id;
                session.email = email;
                session.expires_at = expires_at;
                if let Some(claims) = refreshed_claims {
                    session.auth_provider = derive_auth_provider(&claims);
                    session.given_name = claims.given_name;
                    session.family_name = claims.family_name;
                    session.name = claims.name;
                }
            }
            Ok(true)
        } else {
            Ok(false)
        }
    } else {
        let mut store = session_store.session.lock_or_err()?;
        *store = None;
        Ok(false)
    }
}

/// Bootstrap a session from a stored refresh token (used by keyring restore).
/// Calls /auth/refresh with the given token, then populates SessionStore with
/// a full Session on success. Leaves SessionStore untouched on failure.
pub(crate) async fn bootstrap_from_refresh_token(
    session_store: &State<'_, SessionStore>,
    refresh_token: String,
    user_id: String,
) -> Result<(), String> {
    let body = RefreshBody {
        refresh_token: refresh_token.clone(),
        username: user_id.clone(),
    };
    let client = HttpClient::new();
    let response: ServerAuthResponse = client.post("/auth/refresh", &body)
        .await
        .map_err(|e| format!("Refresh request failed: {}", e))?;

    if !response.success {
        return Err(response.error.unwrap_or_else(|| "Refresh rejected".to_string()));
    }

    let (access_token, id_token, resp_user_id, email, expires_at) = match (
        response.access_token,
        response.id_token,
        response.user_id,
        response.email,
        response.expires_at,
    ) {
        (Some(a), Some(i), Some(u), Some(e), Some(x)) => (a, i, u, e, x),
        _ => return Err("Refresh response missing required fields".to_string()),
    };

    // Re-decode claims so the in-memory Session reflects whatever provider
    // the refreshed id_token came from. Without this the field would default
    // to whatever was first stamped at sign-in and could go stale if the
    // federation provider config changes.
    let claims = decode_id_token_claims(&id_token).ok();
    let auth_provider = claims.as_ref().map(derive_auth_provider).unwrap_or_default();
    let (given_name, family_name, name) = match claims {
        Some(c) => (c.given_name, c.family_name, c.name),
        None => (None, None, None),
    };

    let session = Session {
        access_token,
        refresh_token,
        id_token,
        user_id: resp_user_id,
        email,
        expires_at,
        auth_provider,
        given_name,
        family_name,
        name,
    };
    let mut store = session_store.session.lock_or_err()?;
    *store = Some(session);
    Ok(())
}

/// Get WebSocket URL for realtime connections
#[tauri::command]
pub fn get_websocket_url() -> Result<String, String> {
    crate::config::websocket_url()
}

/// Response from POST /auth/{provider}/start
#[derive(Deserialize)]
struct OAuthStartResponse {
    authorize_url: String,
    state: String,
}

/// Response from GET /auth/{provider}/status
#[derive(Deserialize)]
struct OAuthStatusResponse {
    status: String,
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    error: Option<String>,
}

/// Shared OAuth flow: start → open browser → poll status → populate session.
/// Both Google and Entra delegate here; only the path strings and the user-
/// facing provider label differ.
async fn oauth_sign_in(
    app_handle: tauri::AppHandle,
    session_store: State<'_, SessionStore>,
    start_path: &str,
    status_path: &str,
    provider_label: &str,
) -> Result<AuthResult, String> {
    let client = HttpClient::new();
    let start: OAuthStartResponse =
        client.post(start_path, &serde_json::json!({})).await?;

    app_handle
        .opener()
        .open_url(&start.authorize_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    let poll_url = format!("{}?state={}", status_path, start.state);
    let mut attempts = 0;
    let max_attempts = 150; // 5 minutes at 2 second intervals

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        attempts += 1;

        if attempts > max_attempts {
            return Ok(AuthResult {
                success: false,
                error: Some(format!("{} sign-in timed out. Please try again.", provider_label)),
                user_id: None,
                needs_confirmation: false,
            });
        }

        let status: OAuthStatusResponse = match client.get(&poll_url).await {
            Ok(s) => s,
            Err(_) => continue, // Network blip, keep polling
        };

        match status.status.as_str() {
            "pending" => continue,
            "complete" => {
                let access_token = status.access_token.unwrap_or_default();
                let id_token = status.id_token.unwrap_or_default();
                let refresh_token = status.refresh_token.unwrap_or_default();

                // Decode the id_token to extract user_id (sub) and email
                let claims = decode_id_token_claims(&id_token)?;
                let user_id = claims.sub.clone();
                let email = claims.email.clone().unwrap_or_default();
                let auth_provider = derive_auth_provider(&claims);
                let given_name = claims.given_name.clone();
                let family_name = claims.family_name.clone();
                let name = claims.name.clone();

                // Calculate expiry (Cognito access tokens are typically 1 hour)
                let expires_at = chrono::Utc::now().timestamp() + 3600;

                let session = Session {
                    access_token,
                    refresh_token,
                    id_token,
                    user_id: user_id.clone(),
                    email,
                    expires_at,
                    auth_provider,
                    given_name,
                    family_name,
                    name,
                };

                let mut store = session_store.session.lock_or_err()?;
                *store = Some(session);

                return Ok(AuthResult {
                    success: true,
                    error: None,
                    user_id: Some(user_id),
                    needs_confirmation: false,
                });
            }
            "failed" => {
                return Ok(AuthResult {
                    success: false,
                    error: status
                        .error
                        .or(Some(format!("{} sign-in failed", provider_label))),
                    user_id: None,
                    needs_confirmation: false,
                });
            }
            _ => continue,
        }
    }
}

/// Sign in with Google via the Axum server's OAuth flow
#[command]
pub async fn sign_in_with_google(
    app_handle: tauri::AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<AuthResult, String> {
    oauth_sign_in(
        app_handle,
        session_store,
        "/auth/google/start",
        "/auth/google/status",
        "Google",
    )
    .await
}

/// Sign in with Microsoft Entra via the Axum server's OAuth flow.
/// Cognito federates to Entra based on the `identity_provider` query param
/// the server adds to the authorize URL.
#[command]
pub async fn sign_in_with_entra(
    app_handle: tauri::AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<AuthResult, String> {
    oauth_sign_in(
        app_handle,
        session_store,
        "/auth/entra/start",
        "/auth/entra/status",
        "Microsoft",
    )
    .await
}

/// Decode just the claims from a JWT id_token (no signature verification needed here
/// since the server already verified it with Cognito)
fn decode_id_token_claims(token: &str) -> Result<IdTokenClaims, String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err("Invalid id_token format".to_string());
    }

    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|e| format!("Failed to decode id_token: {}", e))?;

    serde_json::from_slice(&decoded).map_err(|e| format!("Failed to parse id_token claims: {}", e))
}

/// Map the `identities` claim on a Cognito id_token to an `AuthProvider`.
/// Native Cognito (password) users have no `identities`; federated users
/// have one entry whose `providerType`/`providerName` identifies the source.
fn derive_auth_provider(claims: &IdTokenClaims) -> AuthProvider {
    match claims.identities.as_ref().and_then(|v| v.first()) {
        Some(id) if id.provider_type == "SAML" && id.provider_name == "Alpachi-Entra" => {
            AuthProvider::Entra
        }
        Some(id) if id.provider_type == "Google" => AuthProvider::Google,
        _ => AuthProvider::Password,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    provider_name: String,
    provider_type: String,
}

#[derive(Deserialize)]
struct IdTokenClaims {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    given_name: Option<String>,
    family_name: Option<String>,
    identities: Option<Vec<Identity>>,
}
