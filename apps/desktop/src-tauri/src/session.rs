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
//
// DEK lifecycle is **device-bound**, not session-bound. Sign-out only
// deletes the encrypted refresh-token file; the keyring DEK and on-disk
// vault stay intact so signing back in on the same device restores access
// to existing message history. Wiping the keyring + vault is reserved for
// either explicit account removal (`wipe_user`) or genuinely-corrupt local
// state (DEK length wrong, undecryptable session.enc, DB mount failure).

use crate::app_path::{self, AppPaths};
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
use std::path::PathBuf;
use tauri::{command, AppHandle, State};
use zeroize::Zeroizing;

const KEYRING_SERVICE: &str = "cryptex.app.com";
const KEYRING_ACCOUNT: &str = "active_session";
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

/// Outcome of attempting to restore a persisted session at launch.
pub enum RestoreOutcome {
    /// Full session restored: DEK mounted, tokens refreshed.
    Restored,
    /// No keyring entry on disk (or session.enc missing) — caller should
    /// route to login. Existing keyring + vault remain available for the
    /// next sign-in attempt.
    NotAuthenticated,
}

pub struct SessionPersistence {
    app: AppHandle,
    app_data: PathBuf,
}

impl SessionPersistence {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            app: app.clone(),
            app_data: app_path::app_data_dir(app)?,
        })
    }

    fn entry() -> Result<Entry, String> {
        Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|e| format!("Keyring entry creation failed: {}", e))
    }

    fn session_file(&self) -> PathBuf {
        app_path::session_file(&self.app_data)
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

    /// Persist the current session: writes the keyring payload (user, DEK)
    /// and the DEK-encrypted refresh token to disk.
    pub fn save_session(
        &self,
        dek: &[u8; 32],
        user_id: &str,
        email: &str,
        refresh_token: &str,
    ) -> Result<(), String> {
        log::info!("save_session: starting for user_id={}", user_id);

        std::fs::create_dir_all(&self.app_data)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;

        let enc_refresh = Self::encrypt_with_dek(dek, refresh_token.as_bytes())?;
        let session_path = self.session_file();
        std::fs::write(&session_path, enc_refresh)
            .map_err(|e| format!("Failed to write session file: {}", e))?;
        log::info!("save_session: wrote session.enc at {:?}", session_path);

        let payload = KeyringPayload {
            user_id: user_id.to_string(),
            email: email.to_string(),
            dek_b64: general_purpose::STANDARD.encode(dek),
        };
        let json = serde_json::to_string(&payload)
            .map_err(|e| format!("Serialize failed: {}", e))?;

        log::info!(
            "save_session: writing keyring entry service={} account={}",
            KEYRING_SERVICE,
            KEYRING_ACCOUNT
        );
        match Self::entry()?.set_password(&json) {
            Ok(()) => {
                log::info!("save_session: keyring write SUCCESS for user_id={}", user_id);
                Ok(())
            }
            Err(e) => {
                log::error!("save_session: keyring write FAILED for user_id={}: {}", user_id, e);
                Err(format!("Keyring write failed: {}", e))
            }
        }
    }

    /// Read the DEK from the OS keyring for the given user. Returns Ok(None)
    /// if no keyring entry exists or the stored user_id does not match
    /// (caller should treat that as "vault unrecoverable on this device").
    pub(crate) fn load_dek_for_user(
        &self,
        user_id: &str,
    ) -> Result<Option<Zeroizing<[u8; 32]>>, String> {
        load_dek_for_user_inner(user_id)
    }

    /// Inspect the keyring without restoring. Returns `Ok(None)` if no entry
    /// exists; never reveals the DEK or refresh token.
    pub fn peek_stored_user(&self) -> Result<Option<PublicStoredSession>, String> {
        match Self::entry()?.get_password() {
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

    /// Restore the full authenticated session at launch:
    ///   1. Read keyring → DEK + user identity. Missing entry → NotAuthenticated.
    ///   2. Read & decrypt session.enc → refresh token. Missing file →
    ///      NotAuthenticated (user signed out previously).
    ///   3. Mount DEK, open encrypted DB, populate LocalDb.
    ///   4. Refresh Cognito tokens, populate SessionStore.
    ///
    /// Sign-out is not destructive in this design: only genuinely-corrupt
    /// local state (wrong DEK length, undecryptable session.enc, DB mount
    /// failure) wipes the keyring + vault. Transient failures (network,
    /// missing session.enc, identity mismatch) leave credentials intact so
    /// the next attempt can recover.
    pub async fn restore(
        &self,
        local_db: &State<'_, LocalDb>,
        session_store: &State<'_, SessionStore>,
    ) -> Result<RestoreOutcome, String> {
        let payload = match Self::entry()?.get_password() {
            Ok(json) => serde_json::from_str::<KeyringPayload>(&json)
                .map_err(|e| format!("Deserialize failed: {}", e))?,
            Err(keyring::Error::NoEntry) => return Ok(RestoreOutcome::NotAuthenticated),
            Err(e) => return Err(format!("Keyring read failed: {}", e)),
        };

        let dek_bytes = general_purpose::STANDARD
            .decode(&payload.dek_b64)
            .map_err(|e| format!("Invalid stored DEK: {}", e))?;
        if dek_bytes.len() != 32 {
            // Corrupt local state — keyring entry is unusable. Wipe so the
            // next sign-in writes a clean entry.
            self.wipe_local_artifacts(&payload.user_id);
            return Err("Stored DEK has wrong length".to_string());
        }
        let mut dek_array = [0u8; 32];
        dek_array.copy_from_slice(&dek_bytes);
        let dek = Zeroizing::new(dek_array);

        // session.enc missing means the user signed out (or the file was
        // removed externally). Don't wipe — the keyring DEK + vault file are
        // still valid; caller falls through to the login screen and a fresh
        // sign-in will write a new session.enc.
        let enc_refresh = match std::fs::read(self.session_file()) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RestoreOutcome::NotAuthenticated);
            }
            Err(e) => {
                return Err(format!("Session file unreadable: {}", e));
            }
        };
        let refresh_bytes = match Self::decrypt_with_dek(&dek, &enc_refresh) {
            Ok(bytes) => bytes,
            Err(e) => {
                // Undecryptable session.enc means it doesn't match the
                // keyring DEK — local state is genuinely corrupt.
                self.wipe_local_artifacts(&payload.user_id);
                return Err(e);
            }
        };
        let refresh_token = String::from_utf8(refresh_bytes)
            .map_err(|e| format!("Refresh token not valid UTF-8: {}", e))?;

        let stored_user_id = payload.user_id.clone();
        if let Err(e) = local_db::mount_dek(&self.app_data, local_db, &stored_user_id, dek) {
            // DB mount failure with a fingerprint-matching DEK is corrupt
            // local state — wipe so next launch does fresh setup.
            self.wipe_local_artifacts(&payload.user_id);
            return Err(format!("Local DB mount failed: {}", e));
        }

        if let Err(e) = auth::bootstrap_from_refresh_token(
            session_store,
            refresh_token,
            stored_user_id.clone(),
        )
        .await
        {
            // Transient: refresh token may be revoked or the network is
            // down. Don't destroy credentials — clear in-memory vault state
            // so we don't leave a DEK dangling without a session, and let
            // the caller route to login.
            let _ = local_db::clear_vault_state(local_db);
            return Err(format!("Session refresh failed: {}", e));
        }

        // Defence in depth: server-side identity must match what we stored.
        let server_user_id = {
            let store = session_store
                .session
                .lock()
                .map_err(|_| "Session mutex poisoned".to_string())?;
            store.as_ref().map(|s| s.user_id.clone())
        };
        if server_user_id.as_deref() != Some(stored_user_id.as_str()) {
            let _ = local_db::clear_vault_state(local_db);
            let mut store = session_store
                .session
                .lock()
                .map_err(|_| "Session mutex poisoned".to_string())?;
            *store = None;
            return Err("Identity mismatch between stored vault and Cognito session".to_string());
        }

        Ok(RestoreOutcome::Restored)
    }

    /// Clear authentication state for sign-out: deletes only the encrypted
    /// refresh-token file. The keyring DEK and on-disk vault stay intact so
    /// the user can sign back in on the same device and recover their
    /// existing message history.
    pub fn clear_auth_state(&self) -> Result<(), String> {
        match std::fs::remove_file(self.session_file()) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Failed to remove session file: {}", e)),
        }
    }

    /// Destructive removal of the user's local footprint on this device:
    /// keyring entry, session.enc, vault file, encrypted message DB (and
    /// SQLite companions), and MLS state. Reserved for explicit account
    /// removal or genuinely-corrupt local state. **Not** called from
    /// sign-out.
    pub fn wipe_user(&self, user_id: &str) -> Result<(), String> {
        self.wipe_local_artifacts(user_id);
        Ok(())
    }

    fn wipe_local_artifacts(&self, user_id: &str) {
        let _ = Self::entry().and_then(|e| {
            e.delete_credential().map_err(|err| format!("{}", err))
        });
        let _ = std::fs::remove_file(self.session_file());

        if let Ok(paths) = AppPaths::new(&self.app, user_id) {
            let _ = std::fs::remove_file(paths.vault());
            let _ = std::fs::remove_file(paths.messages_db());
            let _ = std::fs::remove_file(paths.messages_db_wal());
            let _ = std::fs::remove_file(paths.messages_db_shm());
            let _ = std::fs::remove_file(paths.messages_db_unencrypted());
            let _ = std::fs::remove_file(paths.mls_state());
            let _ = std::fs::remove_file(paths.mls_meta());
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri command wrappers — thin shims so the JS-side IPC contract is unchanged.
// ---------------------------------------------------------------------------

#[command]
pub fn session_save(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    log::info!("session_save: command invoked");
    let dek: Zeroizing<[u8; 32]> = {
        let guard = local_db
            .dek
            .lock()
            .map_err(|_| "DEK mutex poisoned".to_string())?;
        guard.as_ref().cloned().ok_or_else(|| {
            log::error!("session_save: aborting — Vault not unlocked (no DEK in LocalDb)");
            "Vault not unlocked".to_string()
        })?
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

    let persistence = SessionPersistence::new(&app)?;
    persistence.save_session(&dek, &user_id, &email, &refresh_token)
}

#[command]
pub fn session_stored(app: AppHandle) -> Result<Option<PublicStoredSession>, String> {
    SessionPersistence::new(&app)?.peek_stored_user()
}

#[command]
pub async fn session_restore(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    session_store: State<'_, SessionStore>,
) -> Result<bool, String> {
    let persistence = SessionPersistence::new(&app)?;
    match persistence.restore(&local_db, &session_store).await? {
        RestoreOutcome::Restored => Ok(true),
        RestoreOutcome::NotAuthenticated => Ok(false),
    }
}

#[command]
pub fn session_clear(app: AppHandle) -> Result<(), String> {
    SessionPersistence::new(&app)?.clear_auth_state()
}

/// Module-level helper used by `local_db::unlock_vault` to fetch the keyring
/// DEK without an `AppHandle`. Equivalent to
/// `SessionPersistence::load_dek_for_user`.
pub(crate) fn load_dek_for_user(
    user_id: &str,
) -> Result<Option<Zeroizing<[u8; 32]>>, String> {
    load_dek_for_user_inner(user_id)
}

fn load_dek_for_user_inner(
    user_id: &str,
) -> Result<Option<Zeroizing<[u8; 32]>>, String> {
    log::info!(
        "load_dek_for_user: requesting DEK for user_id={} service={} account={}",
        user_id,
        KEYRING_SERVICE,
        KEYRING_ACCOUNT
    );
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring entry creation failed: {}", e))?;
    let json = match entry.get_password() {
        Ok(json) => json,
        Err(keyring::Error::NoEntry) => {
            log::warn!(
                "load_dek_for_user: NoEntry — keyring has no entry for user_id={}",
                user_id
            );
            return Ok(None);
        }
        Err(e) => {
            log::error!("load_dek_for_user: keyring read FAILED: {}", e);
            return Err(format!("Keyring read failed: {}", e));
        }
    };
    let payload: KeyringPayload =
        serde_json::from_str(&json).map_err(|e| format!("Deserialize failed: {}", e))?;
    if payload.user_id != user_id {
        log::warn!(
            "load_dek_for_user: user_id MISMATCH — keyring has {} but caller asked for {}",
            payload.user_id,
            user_id
        );
        return Ok(None);
    }
    let dek_bytes = general_purpose::STANDARD
        .decode(&payload.dek_b64)
        .map_err(|e| format!("Invalid stored DEK: {}", e))?;
    if dek_bytes.len() != 32 {
        return Err("Stored DEK has wrong length".to_string());
    }
    let mut dek_array = [0u8; 32];
    dek_array.copy_from_slice(&dek_bytes);
    log::info!("load_dek_for_user: keyring read SUCCESS for user_id={}", user_id);
    Ok(Some(Zeroizing::new(dek_array)))
}
