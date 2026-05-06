// src-tauri/src/session_store.rs

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::sync_utils::MutexExt;

/// Number of seconds before token expiry to consider it stale.
const EXPIRY_BUFFER_SECS: i64 = 60;

/// In-memory representation of an authenticated user session.
#[derive(Clone, Serialize, Deserialize, Default)]
pub(crate) struct Session {
    access_token: String,
    refresh_token: String,
    id_token: String,
    user_id: String,
    email: String,
    expires_at: i64,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("user_id", &self.user_id)
            .field("email", &self.email)
            .field("expires_at", &self.expires_at)
            .field("access_token", &"[REDACTED]")
            .field("refresh_token", &"[REDACTED]")
            .field("id_token", &"[REDACTED]")
            .finish()
    }
}

impl Session {
    /// Constructs a new Session from its raw fields.
    pub(crate) fn new(
        access_token: String,
        refresh_token: String,
        id_token: String,
        user_id: String,
        email: String,
        expires_at: i64,
    ) -> Self {
        Self {
            access_token,
            refresh_token,
            id_token,
            user_id,
            email,
            expires_at,
        }
    }

    /// Returns the user ID.
    pub(crate) fn user_id(&self) -> &str {
        &self.user_id
    }

    /// Returns the user's email address.
    pub(crate) fn email(&self) -> &str {
        &self.email
    }

    /// Returns the access token used to authenticate API requests.
    pub(crate) fn access_token(&self) -> &str {
        &self.access_token
    }

    /// Returns the refresh token used to obtain new access tokens.
    pub(crate) fn refresh_token(&self) -> &str {
        &self.refresh_token
    }

    /// Returns the OpenID Connect identity token.
    pub(crate) fn id_token(&self) -> &str {
        &self.id_token
    }

    /// Returns the access token's expiry as a Unix timestamp.
    pub(crate) fn expires_at(&self) -> i64 {
        self.expires_at
    }
}

/// Snapshot of authenticated session data scoped to a single command's lifetime.
pub(crate) struct AuthContext {
    pub(crate) user_id: String,
    pub(crate) access_token: String,
}

impl std::fmt::Debug for AuthContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthContext")
            .field("user_id", &self.user_id)
            .field("access_token", &"[REDACTED]")
            .finish()
    }
}

/// Frontend-facing session info containing only non-sensitive fields.
#[derive(Serialize)]
pub(crate) struct PublicSessionInfo {
    pub(crate) user_id: String,
    pub(crate) email: String,
    pub(crate) is_authenticated: bool,
}

/// Tauri-managed in-memory store for the authenticated user's session.
pub(crate) struct SessionStore {
    session: Mutex<Option<Session>>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }
}

impl SessionStore {
    /// Returns the user ID and access token from the live session, errors if expired or absent.
    pub(crate) fn auth_context(&self) -> Result<AuthContext, String> {
        let store = self.session.lock_or_err()?;
        let session = store
            .as_ref()
            .ok_or_else(|| "Not authenticated".to_string())?;
        if chrono::Utc::now().timestamp() + EXPIRY_BUFFER_SECS >= session.expires_at() {
            return Err("Session expired".to_string());
        }
        Ok(AuthContext {
            user_id: session.user_id().to_string(),
            access_token: session.access_token().to_string(),
        })
    }

    /// Returns just the user ID without checking token expiry.
    pub(crate) fn user_id(&self) -> Result<String, String> {
        let store = self.session.lock_or_err()?;
        store
            .as_ref()
            .map(|s| s.user_id().to_string())
            .ok_or_else(|| "Not authenticated".to_string())
    }

    /// Replaces the entire session.
    pub(crate) fn set(&self, session: Session) -> Result<(), String> {
        let mut store = self.session.lock_or_err()?;
        *store = Some(session);
        Ok(())
    }

    /// Clears the stored session.
    pub(crate) fn clear(&self) -> Result<(), String> {
        let mut store = self.session.lock_or_err()?;
        *store = None;
        Ok(())
    }

    /// Runs a closure with read access to the session, errors if not authenticated.
    pub(crate) fn with_session<R>(
        &self,
        f: impl FnOnce(&Session) -> R,
    ) -> Result<R, String> {
        let store = self.session.lock_or_err()?;
        let session = store
            .as_ref()
            .ok_or_else(|| "Not authenticated".to_string())?;
        Ok(f(session))
    }

    /// Replaces the session's tokens after a refresh, preserving user ID and email.
    pub(crate) fn replace_tokens(
        &self,
        access_token: String,
        refresh_token: String,
        id_token: String,
        expires_at: i64,
    ) -> Result<(), String> {
        let mut store = self.session.lock_or_err()?;
        let session = store
            .as_mut()
            .ok_or_else(|| "Not authenticated".to_string())?;
        session.access_token = access_token;
        session.refresh_token = refresh_token;
        session.id_token = id_token;
        session.expires_at = expires_at;
        Ok(())
    }
}
