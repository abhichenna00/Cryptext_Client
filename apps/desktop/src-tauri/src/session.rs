// src-tauri/src/session.rs
//
// OS keyring–backed session persistence. Stores everything needed to resume
// an authenticated session without user input: the DEK that decrypts the
// local SQLCipher DB, plus the Cognito refresh token that gets us fresh
// access/id tokens.
//
// Storage split:
//   - Per-user keyring entry (account `active_session_dek_<user_id>`) holding
//     that user's DEK. Keying the account by user_id means a second account
//     signing in on the same device can't overwrite the first user's DEK —
//     each user's key survives independently. Small payload, fits Windows
//     Credential Manager's ~2560-char blob limit.
//   - "Last active" pointer entry (account `active_session`) holding the
//     user_id/email/DEK of whoever signed in most recently. Used at launch to
//     decide which user to auto-restore and to render "continue as <email>".
//     This one is intentionally overwritten on each sign-in; it's just a
//     pointer, never the sole copy of any user's DEK.
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
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, State};
use zeroize::Zeroizing;

// Keyring service name. Kept as the original pre-rebrand identifier so existing
// installs' credentials (and the matching app-data directory, which derives from
// the bundle identifier below) resolve without migration. The NShroud rebrand is
// display-only (productName); identity strings stay stable.
const KEYRING_SERVICE: &str = "cryptex.app.com";
// "Last active" pointer account — overwritten on every sign-in. Never the sole
// copy of a DEK; per-user entries below hold the durable keys.
const KEYRING_ACCOUNT: &str = "active_session";
const NONCE_LEN: usize = 12;

/// Keyring account holding a specific user's DEK. Keyed by user_id so accounts
/// don't clobber each other's keys on a shared device.
fn dek_account(user_id: &str) -> String {
    format!("{}_dek_{}", KEYRING_ACCOUNT, user_id)
}

fn dek_entry(user_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, &dek_account(user_id))
        .map_err(|e| format!("Keyring entry creation failed: {}", e))
}

/// Atomic write: stage to a sibling .tmp file, fsync, then rename over the
/// target so a crash mid-write can never leave a truncated file. A torn
/// session.enc would otherwise fail to decrypt on next launch and (previously)
/// trigger a destructive wipe of the message DB.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp_path = path.with_extension("tmp");
    {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|e| format!("Failed to create temp session file: {}", e))?;
        f.write_all(bytes)
            .map_err(|e| format!("Failed to write temp session file: {}", e))?;
        f.sync_all()
            .map_err(|e| format!("Failed to fsync temp session file: {}", e))?;
    }
    std::fs::rename(&tmp_path, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to swap session file into place: {}", e)
    })
}

/// Decode + validate a keyring payload, returning the DEK only if the stored
/// user_id matches `want_user_id`. `Ok(None)` means "not this user".
fn dek_from_payload_json(
    json: &str,
    want_user_id: &str,
) -> Result<Option<Zeroizing<[u8; 32]>>, String> {
    let payload: KeyringPayload =
        serde_json::from_str(json).map_err(|e| format!("Deserialize failed: {}", e))?;
    if payload.user_id != want_user_id {
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
    Ok(Some(Zeroizing::new(dek_array)))
}

/// Write a user's DEK to its per-user keyring entry. Idempotent. Called both
/// by `save_session` and by `setup_vault` (so the DEK is durable before the
/// freshly-keyed DB is used and the old unencrypted DB is deleted).
pub(crate) fn persist_dek_for_user(
    user_id: &str,
    email: &str,
    dek: &[u8; 32],
) -> Result<(), String> {
    let payload = KeyringPayload {
        user_id: user_id.to_string(),
        email: email.to_string(),
        dek_b64: general_purpose::STANDARD.encode(dek),
    };
    let json = serde_json::to_string(&payload).map_err(|e| format!("Serialize failed: {}", e))?;
    dek_entry(user_id)?
        .set_password(&json)
        .map_err(|e| format!("Keyring write failed: {}", e))
}

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
        atomic_write(&session_path, &enc_refresh)?;
        log::info!("save_session: wrote session.enc at {:?}", session_path);

        // Durable per-user DEK entry first — this is the copy that survives a
        // second account signing in on the same device.
        persist_dek_for_user(user_id, email, dek)?;

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
    /// Restore is **non-destructive**: it never deletes the vault or message
    /// DB on its own. A torn session.enc, a transiently-locked DB, or a
    /// keyring/vault mismatch all leave the encrypted history on disk and
    /// surface an error so the user can retry or make an explicit choice
    /// (re-login, or the deliberate "discard local history" action). Silently
    /// wiping message history from launch-time code is never correct — a
    /// transient I/O hiccup must not look like permanent data loss.
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
        let stored_user_id = payload.user_id.clone();

        // Resolve the DEK via the durable per-user entry (with legacy-pointer
        // fallback + migration). The pointer's own embedded DEK is only a hint;
        // the per-user entry is the source of truth.
        let dek = match load_dek_for_user_inner(&stored_user_id)? {
            Some(dek) => dek,
            None => {
                // No usable DEK on this device. Nothing to wipe — leave the
                // encrypted DB in place in case the keyring is restored later.
                return Err("Stored DEK unavailable for this user".to_string());
            }
        };

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
                // Undecryptable session.enc: the file is corrupt (e.g. a torn
                // write) or stale relative to the DEK. Discard ONLY the bad
                // refresh-token file — the DEK-encrypted message DB is
                // untouched. A fresh sign-in rewrites session.enc and unlocks
                // the existing history.
                let _ = std::fs::remove_file(self.session_file());
                log::warn!("restore: discarded undecryptable session.enc; DB left intact");
                return Err(e);
            }
        };
        let refresh_token = String::from_utf8(refresh_bytes)
            .map_err(|e| format!("Refresh token not valid UTF-8: {}", e))?;

        if let Err(e) = local_db::mount_dek(&self.app_data, local_db, &stored_user_id, dek) {
            // Mount failure here is NOT proof of corruption — the DB may be
            // momentarily locked (antivirus, backup tool, another process) or
            // hitting transient I/O. Never wipe; surface the error and let the
            // next launch retry against the still-intact DB.
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
        // Delete this user's durable DEK entry.
        let _ = dek_entry(user_id).and_then(|e| {
            e.delete_credential().map_err(|err| format!("{}", err))
        });
        // Only clear the shared "last active" pointer if it currently points at
        // this user — otherwise we'd strand a different account whose key still
        // lives in its own per-user entry.
        if let Ok(entry) = Self::entry() {
            if let Ok(json) = entry.get_password() {
                if let Ok(payload) = serde_json::from_str::<KeyringPayload>(&json) {
                    if payload.user_id == user_id {
                        let _ = entry.delete_credential();
                    }
                }
            }
        }
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
        "load_dek_for_user: requesting DEK for user_id={} account={}",
        user_id,
        dek_account(user_id)
    );

    // 1. Durable per-user entry — the source of truth.
    match dek_entry(user_id)?.get_password() {
        Ok(json) => {
            if let Some(dek) = dek_from_payload_json(&json, user_id)? {
                log::info!("load_dek_for_user: per-user entry HIT for user_id={}", user_id);
                return Ok(Some(dek));
            }
            // Entry exists but the embedded user_id doesn't match the account
            // it's filed under — treat as absent and fall through to legacy.
            log::warn!(
                "load_dek_for_user: per-user entry payload mismatch for user_id={}",
                user_id
            );
        }
        Err(keyring::Error::NoEntry) => {}
        Err(e) => {
            log::error!("load_dek_for_user: per-user keyring read FAILED: {}", e);
            return Err(format!("Keyring read failed: {}", e));
        }
    }

    // 2. Legacy fallback: older installs stored the DEK only in the shared
    //    "active_session" pointer. If it belongs to this user, adopt it and
    //    migrate into the per-user entry so the next sign-in can't clobber it.
    let legacy = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring entry creation failed: {}", e))?;
    let json = match legacy.get_password() {
        Ok(json) => json,
        Err(keyring::Error::NoEntry) => {
            log::warn!("load_dek_for_user: no per-user or legacy entry for user_id={}", user_id);
            return Ok(None);
        }
        Err(e) => {
            log::error!("load_dek_for_user: legacy keyring read FAILED: {}", e);
            return Err(format!("Keyring read failed: {}", e));
        }
    };
    let dek = match dek_from_payload_json(&json, user_id)? {
        Some(dek) => dek,
        None => {
            log::warn!(
                "load_dek_for_user: legacy pointer holds a different user; no DEK for user_id={}",
                user_id
            );
            return Ok(None);
        }
    };
    // Best-effort migration; a failure here just means we retry next time.
    if let Err(e) = persist_dek_for_user(user_id, "", &dek) {
        log::warn!("load_dek_for_user: migration to per-user entry failed: {}", e);
    } else {
        log::info!("load_dek_for_user: migrated legacy DEK to per-user entry for user_id={}", user_id);
    }
    Ok(Some(dek))
}
