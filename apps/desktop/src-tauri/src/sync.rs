use crate::auth::{self, SessionStore};
use crate::http_client;
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
// UPLOAD COMMANDS
// ============================================

#[command]
pub async fn sync_upload_vault(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let token = auth::get_token(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let vault_path = vault::vault_path(&app_data, &user_id);
    let vault_bytes = std::fs::read(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;

    http_client::put_bytes("/sync/vault", &token, vault_bytes).await
}

#[command]
pub async fn sync_upload_mls_state(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
    local_db: State<'_, LocalDb>,
    _mls_state: State<'_, MlsState>,
) -> Result<(), String> {
    let token = auth::get_token(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let dek = get_dek(&local_db)?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let state_path = app_data.join(format!("mls_{}.json", user_id));
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

    let encrypted = encrypt_with_dek(&dek, &combined_bytes)?;
    http_client::put_bytes("/sync/mls-state", &token, encrypted).await
}

#[command]
pub async fn sync_upload_messages_db(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let token = auth::get_token(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let db_bytes = std::fs::read(&db_path)
        .map_err(|e| format!("Failed to read messages DB: {}", e))?;

    http_client::put_bytes("/sync/messages-db", &token, db_bytes).await
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
    let token = auth::get_token(&session_store)?;
    let resp: SyncExistsResponse = http_client::get("/sync/exists", &token).await?;
    Ok(resp.exists)
}

#[command]
pub async fn sync_download_vault(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let token = auth::get_token(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let vault_bytes = http_client::get_bytes("/sync/vault", &token).await?;
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
    let token = auth::get_token(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let dek = get_dek(&local_db)?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let encrypted = http_client::get_bytes("/sync/mls-state", &token).await?;
    let decrypted = decrypt_with_dek(&dek, &encrypted)?;

    let combined: serde_json::Value = serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Failed to parse MLS bundle: {}", e))?;

    let state_bytes: Vec<u8> = serde_json::from_value(combined["state"].clone())
        .map_err(|e| format!("Failed to extract MLS state: {}", e))?;
    let meta_bytes: Vec<u8> = serde_json::from_value(combined["meta"].clone())
        .unwrap_or_default();

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
pub async fn sync_download_messages_db(
    app: AppHandle,
    session_store: State<'_, SessionStore>,
) -> Result<(), String> {
    let token = auth::get_token(&session_store)?;
    let user_id = auth::get_user_id_from_session(&session_store)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let db_bytes = http_client::get_bytes("/sync/messages-db", &token).await?;
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    std::fs::write(&db_path, db_bytes)
        .map_err(|e| format!("Failed to write messages DB: {}", e))?;

    Ok(())
}
