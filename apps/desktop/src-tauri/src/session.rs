// src-tauri/src/session.rs
//
// OS keyring–backed session persistence. Stores everything needed to resume
// an authenticated session without user input: the DEK that decrypts the
// local SQLCipher DB, plus the Cognito refresh token that gets us fresh
// access/id tokens.
//
// Storage: one entry in the OS credential store (Windows Credential Manager
// / macOS Keychain / Linux Secret Service), keyed by a fixed service +
// account pair. The entry value is a JSON blob with the DEK base64-encoded.
// The keyring is user-scoped and auto-unlocked by the OS login, so reads
// are silent.

use crate::auth::{self, SessionStore};
use crate::local_db::{self, LocalDb};
use base64::{engine::general_purpose, Engine};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager, State};

const KEYRING_SERVICE: &str = "cryptex.app.com";
const KEYRING_ACCOUNT: &str = "active_session";

#[derive(Serialize, Deserialize)]
struct StoredSession {
    user_id: String,
    email: String,
    dek_b64: String,
    refresh_token: String,
}

#[derive(Serialize, Deserialize)]
pub struct PublicStoredSession {
    pub user_id: String,
    pub email: String,
}

fn entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring entry creation failed: {}", e))
}

/// Save the current session (DEK + refresh token + user identity) to the
/// OS keyring. Called after successful password sign-in so subsequent
/// launches can auto-restore without a login prompt.
#[command]
pub fn session_save(
    local_db: State<'_, LocalDb>,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let dek = {
        let guard = local_db.dek.lock().map_err(|_| "DEK mutex poisoned".to_string())?;
        *guard.as_ref().ok_or("Vault not unlocked")?
    };
    let (user_id, email, refresh_token) = {
        let store = session_store.session.lock().map_err(|_| "Session mutex poisoned".to_string())?;
        let sess = store.as_ref().ok_or("No active session")?;
        (sess.user_id.clone(), sess.email.clone(), sess.refresh_token.clone())
    };

    let stored = StoredSession {
        user_id,
        email,
        dek_b64: general_purpose::STANDARD.encode(dek),
        refresh_token,
    };
    let json = serde_json::to_string(&stored)
        .map_err(|e| format!("Serialize failed: {}", e))?;

    entry()?
        .set_password(&json)
        .map_err(|e| format!("Keyring write failed: {}", e))
}

/// Peek at the stored session without restoring it. Returns the user_id and
/// email if an entry exists, or None. Does not reveal the DEK or refresh
/// token to the frontend.
#[command]
pub fn session_stored() -> Result<Option<PublicStoredSession>, String> {
    match entry()?.get_password() {
        Ok(json) => {
            let stored: StoredSession = serde_json::from_str(&json)
                .map_err(|e| format!("Deserialize failed: {}", e))?;
            Ok(Some(PublicStoredSession {
                user_id: stored.user_id,
                email: stored.email,
            }))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring read failed: {}", e)),
    }
}

/// Restore the full authenticated session from the keyring:
///   1. Load the DEK, open the encrypted local DB, populate LocalDb state.
///   2. Refresh Cognito tokens with the stored refresh token and populate
///      SessionStore.
///
/// On any failure (revoked refresh token, missing DB file, tampered vault)
/// the keyring entry is cleared so the next launch falls back to the login
/// screen cleanly. Returns Ok(true) on restore, Ok(false) if no entry.
#[command]
pub async fn session_restore(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    session_store: State<'_, SessionStore>,
) -> Result<bool, String> {
    let stored = match entry()?.get_password() {
        Ok(json) => serde_json::from_str::<StoredSession>(&json)
            .map_err(|e| format!("Deserialize failed: {}", e))?,
        Err(keyring::Error::NoEntry) => return Ok(false),
        Err(e) => return Err(format!("Keyring read failed: {}", e)),
    };

    let dek_bytes = general_purpose::STANDARD
        .decode(&stored.dek_b64)
        .map_err(|e| format!("Invalid stored DEK: {}", e))?;
    if dek_bytes.len() != 32 {
        let _ = entry().and_then(|e| e.delete_credential().map_err(|err| format!("{}", err)));
        return Err("Stored DEK has wrong length".to_string());
    }
    let mut dek = [0u8; 32];
    dek.copy_from_slice(&dek_bytes);

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    if let Err(e) = local_db::mount_dek(&app_data, &local_db, &stored.user_id, dek) {
        let _ = entry().and_then(|en| en.delete_credential().map_err(|err| format!("{}", err)));
        return Err(format!("Local DB mount failed: {}", e));
    }

    if let Err(e) = auth::bootstrap_from_refresh_token(
        &session_store,
        stored.refresh_token,
        stored.user_id,
    )
    .await
    {
        let _ = entry().and_then(|en| en.delete_credential().map_err(|err| format!("{}", err)));
        return Err(format!("Session refresh failed: {}", e));
    }

    Ok(true)
}

/// Delete the stored session from the keyring. Call on explicit sign-out.
#[command]
pub fn session_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Keyring delete failed: {}", e)),
    }
}
