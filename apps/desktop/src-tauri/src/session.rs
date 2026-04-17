// src-tauri/src/session.rs
//
// OS keyring–backed session persistence. Stores everything needed to resume
// an authenticated session without user input: the DEK that decrypts the
// local SQLCipher DB, plus the Cognito refresh token that gets us fresh
// access/id tokens.
//
// Storage split:
//   - Keyring entry (user_id, email, DEK) — small payload, fits Windows
//     Credential Manager's ~2560-char blob limit.
//   - session.enc file in app data — DEK-wrapped Cognito refresh token.
//     The refresh token alone can exceed the keyring size cap, so it lives
//     on disk encrypted. The DEK is still keyring-gated, so the file is
//     useless to an attacker without keyring access.

use crate::auth::{self, SessionStore};
use crate::local_db::{self, LocalDb};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose, Engine};
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager, State};
use zeroize::Zeroizing;

const KEYRING_SERVICE: &str = "cryptex.app.com";
const KEYRING_ACCOUNT: &str = "active_session";
const SESSION_FILE: &str = "session.enc";
const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize)]
struct KeyringPayload {
    user_id: String,
    email: String,
    dek_b64: String,
}

#[derive(Serialize, Deserialize)]
struct EncryptedBlob {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
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

fn session_file(app_data: &Path) -> PathBuf {
    app_data.join(SESSION_FILE)
}

fn encrypt_with_dek(dek: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(dek)
        .map_err(|e| format!("Cipher init failed: {}", e))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encrypt failed: {}", e))?;
    let blob = EncryptedBlob {
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    };
    serde_json::to_vec(&blob).map_err(|e| format!("Serialize failed: {}", e))
}

fn decrypt_with_dek(dek: &[u8; 32], encrypted: &[u8]) -> Result<Vec<u8>, String> {
    let blob: EncryptedBlob = serde_json::from_slice(encrypted)
        .map_err(|e| format!("Deserialize failed: {}", e))?;
    let cipher = Aes256Gcm::new_from_slice(dek)
        .map_err(|e| format!("Cipher init failed: {}", e))?;
    let nonce = Nonce::from_slice(&blob.nonce);
    cipher
        .decrypt(nonce, blob.ciphertext.as_ref())
        .map_err(|_| "Refresh token decryption failed".to_string())
}

fn wipe(app_data: &Path) {
    let _ = entry().and_then(|e| e.delete_credential().map_err(|err| format!("{}", err)));
    let _ = std::fs::remove_file(session_file(app_data));
}

/// Save the current session (DEK + refresh token + user identity) to the
/// OS keyring (small part) and an encrypted file (large refresh token).
/// Called after successful password sign-in so subsequent launches can
/// auto-restore without a login prompt.
#[command]
pub fn session_save(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let dek: Zeroizing<[u8; 32]> = {
        let guard = local_db
            .dek
            .lock()
            .map_err(|_| "DEK mutex poisoned".to_string())?;
        guard.as_ref().cloned().ok_or("Vault not unlocked")?
    };
    let (user_id, email, refresh_token) = {
        let store = session_store
            .session
            .lock()
            .map_err(|_| "Session mutex poisoned".to_string())?;
        let sess = store.as_ref().ok_or("No active session")?;
        (
            sess.user_id.clone(),
            sess.email.clone(),
            sess.refresh_token.clone(),
        )
    };

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let enc_refresh = encrypt_with_dek(&dek, refresh_token.as_bytes())?;
    std::fs::write(session_file(&app_data), enc_refresh)
        .map_err(|e| format!("Failed to write session file: {}", e))?;

    let payload = KeyringPayload {
        user_id,
        email,
        dek_b64: general_purpose::STANDARD.encode(&*dek),
    };
    let json = serde_json::to_string(&payload)
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
            let payload: KeyringPayload = serde_json::from_str(&json)
                .map_err(|e| format!("Deserialize failed: {}", e))?;
            Ok(Some(PublicStoredSession {
                user_id: payload.user_id,
                email: payload.email,
            }))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring read failed: {}", e)),
    }
}

/// Restore the full authenticated session:
///   1. Read keyring → DEK + user identity.
///   2. Read & decrypt session.enc → refresh token.
///   3. Mount DEK, open encrypted DB, populate LocalDb.
///   4. Refresh Cognito tokens, populate SessionStore.
///
/// On any failure the keyring entry and session file are wiped so the next
/// launch falls back cleanly to the login screen. Returns Ok(true) on
/// restore, Ok(false) if no entry exists.
#[command]
pub async fn session_restore(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    session_store: State<'_, SessionStore>,
) -> Result<bool, String> {
    let payload = match entry()?.get_password() {
        Ok(json) => serde_json::from_str::<KeyringPayload>(&json)
            .map_err(|e| format!("Deserialize failed: {}", e))?,
        Err(keyring::Error::NoEntry) => return Ok(false),
        Err(e) => return Err(format!("Keyring read failed: {}", e)),
    };

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dek_bytes = general_purpose::STANDARD
        .decode(&payload.dek_b64)
        .map_err(|e| format!("Invalid stored DEK: {}", e))?;
    if dek_bytes.len() != 32 {
        wipe(&app_data);
        return Err("Stored DEK has wrong length".to_string());
    }
    let mut dek_array = [0u8; 32];
    dek_array.copy_from_slice(&dek_bytes);
    let dek = Zeroizing::new(dek_array);

    let enc_refresh = match std::fs::read(session_file(&app_data)) {
        Ok(bytes) => bytes,
        Err(e) => {
            wipe(&app_data);
            return Err(format!("Session file missing or unreadable: {}", e));
        }
    };
    let refresh_bytes = match decrypt_with_dek(&dek, &enc_refresh) {
        Ok(bytes) => bytes,
        Err(e) => {
            wipe(&app_data);
            return Err(e);
        }
    };
    let refresh_token = String::from_utf8(refresh_bytes)
        .map_err(|e| format!("Refresh token not valid UTF-8: {}", e))?;

    let stored_user_id = payload.user_id.clone();
    if let Err(e) = local_db::mount_dek(&app_data, &local_db, &stored_user_id, dek) {
        wipe(&app_data);
        return Err(format!("Local DB mount failed: {}", e));
    }

    if let Err(e) =
        auth::bootstrap_from_refresh_token(&session_store, refresh_token, stored_user_id.clone())
            .await
    {
        wipe(&app_data);
        // Also clear in-memory vault state so we don't leave DEK dangling
        // with no authenticated session to match.
        let _ = local_db::clear_vault_state(&local_db);
        return Err(format!("Session refresh failed: {}", e));
    }

    // Defence in depth: confirm the server-side identity matches what we
    // stored locally. A mismatch would mean the refresh token belongs to a
    // different user than the DEK, which should never happen normally.
    let server_user_id = {
        let store = session_store
            .session
            .lock()
            .map_err(|_| "Session mutex poisoned".to_string())?;
        store.as_ref().map(|s| s.user_id.clone())
    };
    if server_user_id.as_deref() != Some(stored_user_id.as_str()) {
        wipe(&app_data);
        let _ = local_db::clear_vault_state(&local_db);
        let mut store = session_store
            .session
            .lock()
            .map_err(|_| "Session mutex poisoned".to_string())?;
        *store = None;
        return Err("Identity mismatch between stored vault and Cognito session".to_string());
    }

    Ok(true)
}

/// Delete the stored session (keyring entry + encrypted file). Called on
/// explicit sign-out.
#[command]
pub fn session_clear(app: AppHandle) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    wipe(&app_data);
    Ok(())
}
