use crate::auth::{self, SessionStore};
use crate::http_client::AuthorizedClient;
use crate::local_db::LocalDb;
use crate::mls::MlsState;
use crate::vault;
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager, State};
use zeroize::Zeroizing;
use crate::sync_utils::MutexExt;

const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize)]
struct EncryptedBlob {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

pub(crate) fn encrypt_with_dek(dek: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(dek)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;
    let blob = EncryptedBlob {
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    };
    serde_json::to_vec(&blob).map_err(|e| format!("Serialization failed: {}", e))
}

pub(crate) fn decrypt_with_dek(dek: &[u8; 32], encrypted: &[u8]) -> Result<Vec<u8>, String> {
    let blob: EncryptedBlob =
        serde_json::from_slice(encrypted).map_err(|e| format!("Deserialization failed: {}", e))?;
    let cipher = Aes256Gcm::new_from_slice(dek)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    let nonce = Nonce::from_slice(&blob.nonce);
    cipher
        .decrypt(nonce, blob.ciphertext.as_ref())
        .map_err(|_| "Decryption failed — wrong key or corrupted data".to_string())
}

pub(crate) fn get_dek(local_db: &State<'_, LocalDb>) -> Result<Zeroizing<[u8; 32]>, String> {
    let guard = local_db.dek.lock_or_err()?;
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| "Vault not unlocked — no DEK available".to_string())
}

// ============================================
// UPLOAD HELPERS + COMMANDS
// ============================================

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))
}

async fn upload_vault_inner(
    client: &AuthorizedClient,
    app_data: &std::path::Path,
    user_id: &str,
) -> Result<(), String> {
    let vault_path = vault::vault_path(app_data, user_id);
    let vault_bytes = std::fs::read(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;
    client.put_bytes("/sync/vault", vault_bytes).await
}

async fn upload_messages_db_inner(
    client: &AuthorizedClient,
    app_data: &std::path::Path,
    user_id: &str,
) -> Result<(), String> {
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let db_bytes = std::fs::read(&db_path)
        .map_err(|e| format!("Failed to read messages DB: {}", e))?;
    client.put_bytes("/sync/messages-db", db_bytes).await
}

/// Encrypt and upload MLS state. Returns `Ok(false)` when there's no MLS state
/// on disk yet (user has no conversations) — that's not an error.
async fn upload_mls_state_inner(
    client: &AuthorizedClient,
    app_data: &std::path::Path,
    user_id: &str,
    dek: &[u8; 32],
) -> Result<bool, String> {
    let state_path = app_data.join(format!("mls_{}.json", user_id));
    if !state_path.exists() {
        return Ok(false);
    }
    let meta_path = state_path.with_extension("meta.json");
    let state_bytes = std::fs::read(&state_path)
        .map_err(|e| format!("Failed to read MLS state: {}", e))?;
    let meta_bytes = std::fs::read(&meta_path).unwrap_or_default();

    let combined = serde_json::json!({
        "state": state_bytes,
        "meta": meta_bytes,
    });
    let combined_bytes = serde_json::to_vec(&combined)
        .map_err(|e| format!("Failed to serialize MLS bundle: {}", e))?;

    let encrypted = encrypt_with_dek(dek, &combined_bytes)?;
    client.put_bytes("/sync/mls-state", encrypted).await?;
    Ok(true)
}

/// Parse a decrypted MLS bundle and write its state/meta files to disk. Shared
/// by `sync_restore_mls_state` and the recovery orchestrator.
fn write_mls_files(app_data: &std::path::Path, user_id: &str, decrypted: &[u8]) -> Result<(), String> {
    let combined: serde_json::Value = serde_json::from_slice(decrypted)
        .map_err(|e| format!("Failed to parse MLS bundle: {}", e))?;
    let state_bytes: Vec<u8> = serde_json::from_value(combined["state"].clone())
        .map_err(|e| format!("Failed to extract MLS state: {}", e))?;
    let meta_bytes: Vec<u8> = serde_json::from_value(combined["meta"].clone()).unwrap_or_default();

    let state_path = app_data.join(format!("mls_{}.json", user_id));
    let meta_path = state_path.with_extension("meta.json");
    std::fs::write(&state_path, &state_bytes)
        .map_err(|e| format!("Failed to write MLS state: {}", e))?;
    if !meta_bytes.is_empty() {
        std::fs::write(&meta_path, &meta_bytes)
            .map_err(|e| format!("Failed to write MLS metadata: {}", e))?;
    }
    Ok(())
}

#[command]
pub async fn sync_upload_vault(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app_data_dir(&app)?;
    upload_vault_inner(&client, &app_data, &user_id).await
}

#[command]
pub async fn sync_upload_mls_state(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
    local_db: State<'_, LocalDb>,
    _mls_state: State<'_, MlsState>,
) -> Result<(), String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let dek = get_dek(&local_db)?;
    let app_data = app_data_dir(&app)?;
    upload_mls_state_inner(&client, &app_data, &user_id, &dek).await?;
    Ok(())
}

#[command]
pub async fn sync_upload_messages_db(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app_data_dir(&app)?;
    upload_messages_db_inner(&client, &app_data, &user_id).await
}

/// Whether the server's backup slot belongs to the DEK we currently hold.
enum BackupOwnership {
    /// No backup on the server yet — safe to seed.
    Empty,
    /// Server backup fingerprints to our DEK — safe to overwrite (it's ours).
    Owned,
    /// Server backup belongs to a different DEK — must NOT overwrite it, or we
    /// destroy history that another device/key could still recover.
    Foreign,
}

async fn backup_ownership(
    client: &AuthorizedClient,
    dek: &[u8; 32],
) -> Result<BackupOwnership, String> {
    let exists: SyncExistsResponse = client.get("/sync/exists").await?;
    if !exists.exists {
        return Ok(BackupOwnership::Empty);
    }
    let server_vault = client.get_bytes("/sync/vault").await?;
    if vault::dek_matches_vault_bytes(&server_vault, dek)? {
        Ok(BackupOwnership::Owned)
    } else {
        Ok(BackupOwnership::Foreign)
    }
}

/// Throttled backup: push the vault marker + messages DB + MLS state to the
/// server, but only when there are unsaved changes (unless `force`). Safe to
/// call on a timer — no-ops cleanly when the vault is locked or nothing has
/// changed.
///
/// Critically, this NEVER uploads over a server slot keyed to a different DEK
/// (e.g. a fresh vault created on a new device where the keyring DEK was lost).
/// `force` bypasses only the dirty check, never the ownership check — otherwise
/// seeding a fresh vault would clobber a still-recoverable backup. When
/// ownership can't be determined (network error), we leave the change pending
/// and retry next tick rather than risk a destructive upload.
#[command]
pub async fn sync_flush_backup(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
    local_db: State<'_, LocalDb>,
    force: bool,
) -> Result<bool, String> {
    // Needs an unlocked vault: the DEK must be in memory for the MLS upload and
    // the ownership check. If locked, quietly skip rather than erroring.
    let dek = match get_dek(&local_db) {
        Ok(d) => d,
        Err(_) => return Ok(false),
    };

    // Peek (don't consume) the dirty flag — we only clear it once we've
    // committed to an upload, so a skip never silently drops a change.
    if !force && !local_db.dirty.load(std::sync::atomic::Ordering::Relaxed) {
        return Ok(false);
    }

    let client = AuthorizedClient::from_session(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app_data_dir(&app)?;

    match backup_ownership(&client, &dek).await {
        Ok(BackupOwnership::Empty) | Ok(BackupOwnership::Owned) => {}
        Ok(BackupOwnership::Foreign) => {
            // The slot belongs to a different key and never will be ours, so
            // stop retrying: clear the flag without uploading.
            local_db.take_dirty();
            log::warn!("sync_flush_backup: server backup keyed to a different DEK; skipping upload");
            return Ok(false);
        }
        Err(_) => {
            // Unknown ownership (network). Leave the dirty flag set so the next
            // tick retries; never upload on uncertainty.
            return Ok(false);
        }
    }

    // Committed to uploading — claim the work now.
    let was_dirty = local_db.take_dirty();

    let result = async {
        upload_vault_inner(&client, &app_data, &user_id).await?;
        upload_messages_db_inner(&client, &app_data, &user_id).await?;
        upload_mls_state_inner(&client, &app_data, &user_id, &dek).await?;
        Ok::<(), String>(())
    }
    .await;

    if let Err(e) = result {
        // Re-arm so the change isn't lost; the next tick retries.
        if was_dirty {
            local_db.mark_dirty();
        }
        return Err(e);
    }
    Ok(true)
}

// ============================================
// DOWNLOAD / RESTORE COMMANDS
// ============================================

#[derive(Deserialize)]
struct SyncExistsResponse {
    exists: bool,
}

#[command]
pub async fn sync_check_exists(
    session_store: State<'_, SessionStore>,
) -> Result<bool, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let resp: SyncExistsResponse = client.get("/sync/exists").await?;
    Ok(resp.exists)
}

#[command]
pub async fn sync_download_vault(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let vault_bytes = client.get_bytes("/sync/vault").await?;
    let vault_path = vault::vault_path(&app_data, &user_id);
    std::fs::write(&vault_path, vault_bytes)
        .map_err(|e| format!("Failed to write vault file: {}", e))?;

    Ok(())
}

#[command]
pub async fn sync_restore_mls_state(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
    local_db: State<'_, LocalDb>,
) -> Result<(), String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let dek = get_dek(&local_db)?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let encrypted = client.get_bytes("/sync/mls-state").await?;
    let decrypted = decrypt_with_dek(&dek, &encrypted)?;
    write_mls_files(&app_data, &user_id, &decrypted)
}

#[command]
pub async fn sync_download_messages_db(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let db_bytes = client.get_bytes("/sync/messages-db").await?;
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    std::fs::write(&db_path, db_bytes)
        .map_err(|e| format!("Failed to write messages DB: {}", e))?;

    Ok(())
}

/// Recover a missing local vault from the server backup using the DEK still
/// held in the OS keyring. This is the safety net for the "local files lost or
/// corrupted, but the keyring survived" case (the device-bound model means a
/// lost keyring is still unrecoverable — by design).
///
/// Returns:
///   - `Ok(true)`  — recovered and mounted; caller proceeds as unlocked.
///   - `Ok(false)` — nothing to recover (no keyring DEK, no server backup, or
///     the backup is keyed to a different DEK). Local disk is left clean so the
///     caller can fall back to a fresh `setup_vault`.
///   - `Err(..)`   — a hard failure (network/IO) partway through.
///
/// Refuses to run if a local vault or DB file already exists, so it can never
/// overwrite good local data.
#[command]
pub async fn sync_recover_local_state(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    session_store: State<'_, SessionStore>,
    user_id: String,
) -> Result<bool, String> {
    if uuid::Uuid::parse_str(&user_id).is_err() {
        return Err("Invalid user_id format".to_string());
    }
    let session_user = auth::get_user_id_from_session(&session_store)?;
    if session_user != user_id {
        return Err("user_id does not match authenticated session".to_string());
    }

    // Without the keyring DEK the server backup is undecryptable — bail so the
    // caller does a fresh setup instead.
    let dek = match crate::session::load_dek_for_user(&user_id)? {
        Some(d) => d,
        None => return Ok(false),
    };

    let app_data = app_data_dir(&app)?;
    let vault_path = vault::vault_path(&app_data, &user_id);
    let db_path = app_data.join(format!("messages_{}.db", user_id));

    // Never overwrite existing local state — recovery is only for the
    // missing-local case.
    if vault_path.exists() || db_path.exists() {
        return Err("Local vault already present; refusing to recover over it".to_string());
    }

    let client = AuthorizedClient::from_session(&session_store)?;
    let exists: SyncExistsResponse = client.get("/sync/exists").await?;
    if !exists.exists {
        return Ok(false);
    }

    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    // 1. Vault fingerprint marker.
    let vault_bytes = client.get_bytes("/sync/vault").await?;
    std::fs::write(&vault_path, &vault_bytes)
        .map_err(|e| format!("Failed to write recovered vault: {}", e))?;

    // 2. The backup must be keyed to the DEK we hold, or mounting it is
    //    pointless. Mismatch → discard the downloaded marker and fall back.
    if vault::verify_fingerprint(&app_data, &user_id, &dek).is_err() {
        let _ = std::fs::remove_file(&vault_path);
        return Ok(false);
    }

    // 3. Messages DB — the actual history.
    match client.get_bytes("/sync/messages-db").await {
        Ok(db_bytes) => {
            if let Err(e) = std::fs::write(&db_path, &db_bytes) {
                let _ = std::fs::remove_file(&vault_path);
                return Err(format!("Failed to write recovered DB: {}", e));
            }
        }
        Err(e) => {
            let _ = std::fs::remove_file(&vault_path);
            return Err(format!("Messages DB download failed: {}", e));
        }
    }

    // 4. Mount with the keyring DEK (opens the recovered SQLCipher DB).
    if let Err(e) = crate::local_db::mount_dek(&app_data, &local_db, &user_id, dek) {
        let _ = std::fs::remove_file(&vault_path);
        let _ = std::fs::remove_file(&db_path);
        return Err(format!("Mount after recovery failed: {}", e));
    }

    // 5. Best-effort MLS restore so ongoing conversations keep decrypting. A
    //    failure here is non-fatal — the normal MLS init/welcome flow can
    //    re-establish group state.
    if let Ok(encrypted) = client.get_bytes("/sync/mls-state").await {
        if let Ok(dek_now) = get_dek(&local_db) {
            if let Ok(decrypted) = decrypt_with_dek(&dek_now, &encrypted) {
                let _ = write_mls_files(&app_data, &user_id, &decrypted);
            }
        }
    }

    Ok(true)
}
