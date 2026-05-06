// src-tauri/src/vault.rs
//
// DEK lifecycle and on-disk vault metadata.
//
// The DEK is a random 256-bit key generated on first setup and stored in the
// OS keyring (see session.rs). The on-disk `.vault` file holds a 16-byte
// SHA-256 fingerprint of the DEK. The fingerprint is not a secret — it can't
// be inverted to recover the DEK — but it lets unlock paths reject a keyring
// DEK that doesn't match this vault (e.g. if `messages_<user_id>.db` was
// deleted out from under us and SQLCipher would otherwise silently create a
// fresh empty DB).

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const DEK_LEN: usize = 32;
const FP_LEN: usize = 16;

#[derive(Serialize, Deserialize)]
struct VaultFile {
    dek_fp: String,
}

fn fingerprint_dek(dek: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(dek);
    let digest = hasher.finalize();
    hex::encode(&digest[..FP_LEN])
}

fn read_vault_file(path: &Path) -> Result<VaultFile, String> {
    let data = std::fs::read(path).map_err(|e| format!("Failed to read vault file: {}", e))?;
    serde_json::from_slice::<VaultFile>(&data)
        .map_err(|e| format!("Failed to parse vault file: {}", e))
}

// Atomic write: stage to a sibling .tmp file, fsync, then rename over the
// target. On Windows std::fs::rename uses MoveFileExW with REPLACE_EXISTING,
// so the rename itself is atomic on the same volume. A crash mid-rewrite
// leaves either the original file intact or the fully-written file in
// place — never a truncated file that parses as neither.
fn write_vault_file(path: &Path, dek: &[u8; 32]) -> Result<(), String> {
    let file = VaultFile {
        dek_fp: fingerprint_dek(dek),
    };
    let bytes = serde_json::to_vec(&file).map_err(|e| format!("Failed to serialize vault: {}", e))?;

    let tmp_path = path.with_extension("vault.tmp");
    {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|e| format!("Failed to create temp vault file: {}", e))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Failed to write temp vault file: {}", e))?;
        f.sync_all()
            .map_err(|e| format!("Failed to fsync temp vault file: {}", e))?;
    }
    std::fs::rename(&tmp_path, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to swap vault file into place: {}", e)
    })
}

// ============================================
// PUBLIC API
// ============================================

pub fn vault_path(app_data_dir: &Path, user_id: &str) -> PathBuf {
    app_data_dir.join(format!("{}.vault", user_id))
}

pub fn vault_exists(app_data_dir: &Path, user_id: &str) -> bool {
    vault_path(app_data_dir, user_id).exists()
}

/// Verify that the supplied DEK matches the on-disk vault's fingerprint.
pub fn verify_fingerprint(
    app_data_dir: &Path,
    user_id: &str,
    dek: &[u8; 32],
) -> Result<(), String> {
    let path = vault_path(app_data_dir, user_id);
    let file = read_vault_file(&path)?;
    if file.dek_fp != fingerprint_dek(dek) {
        return Err("DEK does not match vault fingerprint".to_string());
    }
    Ok(())
}

/// Create a fresh vault: random DEK + on-disk fingerprint marker. The DEK is
/// returned to the caller, which is responsible for stashing it in the
/// keyring (via session_save) and mounting the encrypted DB.
pub fn create_vault(
    app_data_dir: &Path,
    user_id: &str,
) -> Result<Zeroizing<[u8; DEK_LEN]>, String> {
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    rand::thread_rng().fill_bytes(dek.as_mut());

    let path = vault_path(app_data_dir, user_id);
    write_vault_file(&path, &dek)?;
    Ok(dek)
}
