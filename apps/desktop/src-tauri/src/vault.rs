// src-tauri/src/vault.rs
//
// DEK lifecycle and on-disk vault metadata.
//
// v2 (current): the DEK is a random 256-bit key generated on first setup and
// stored in the OS keyring (see session.rs). The on-disk `.vault` file holds
// a version marker plus a 16-byte SHA-256 fingerprint of the DEK. The
// fingerprint is not a secret — it can't be inverted to recover the DEK —
// but it lets unlock paths reject a keyring DEK that doesn't match this
// vault (e.g. if `messages_<user_id>.db` was deleted out from under us and
// SQLCipher would otherwise silently create a fresh empty DB).
//
// v1 (legacy, read-only): the DEK was wrapped by an Argon2id KEK derived from
// the user's login password. Existing v1 vaults can still be unwrapped for a
// one-time migration to v2; new v1 vaults are never written.
//
// The split exists so vault unlock is decoupled from the user's auth method:
// a federated (Google / Entra) sign-in has no password and so cannot wrap or
// unwrap a v1 vault. v2 lets any auth method drive the same unlock path.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const ARGON2_M_COST: u32 = 65536; // 64 MiB
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 4;
const DEK_LEN: usize = 32;
const FP_LEN: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultVersion {
    V1,
    V2,
}

#[derive(Serialize, Deserialize, Clone)]
struct WrappedKey {
    salt: Vec<u8>,
    nonce: Vec<u8>,
    encrypted_dek: Vec<u8>,
}

// v1 multi-method file. Method names were "password" / "pin"; both wrapped
// the same DEK with an Argon2id KEK derived from the corresponding secret.
#[derive(Serialize, Deserialize)]
struct V1VaultFile {
    methods: HashMap<String, WrappedKey>,
}

// v1 single-method file (predates the methods map). Treated as a "password"
// entry during migration.
#[derive(Serialize, Deserialize)]
struct V1LegacyVaultFile {
    salt: Vec<u8>,
    nonce: Vec<u8>,
    encrypted_dek: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct V2VaultFile {
    version: u32,
    dek_fp: String,
}

fn fingerprint_dek(dek: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(dek);
    let digest = hasher.finalize();
    hex::encode(&digest[..FP_LEN])
}

fn derive_kek(secret: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST, Some(32))
        .map_err(|e| format!("Invalid Argon2 params: {}", e))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut kek = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(secret, salt, kek.as_mut())
        .map_err(|e| format!("Argon2 derivation failed: {}", e))?;

    Ok(kek)
}

fn unwrap_dek(
    kek: &[u8; 32],
    encrypted_dek: &[u8],
    nonce_bytes: &[u8],
) -> Result<Zeroizing<[u8; 32]>, String> {
    let cipher = Aes256Gcm::new_from_slice(kek)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let decrypted = cipher
        .decrypt(nonce, encrypted_dek)
        .map_err(|_| "Invalid credentials".to_string())?;

    if decrypted.len() != DEK_LEN {
        return Err("Decrypted DEK has wrong length".to_string());
    }

    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&decrypted);
    Ok(dek)
}

fn open_v1_with_password(entry: &WrappedKey, password: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let kek = derive_kek(password.as_bytes(), &entry.salt)?;
    unwrap_dek(&kek, &entry.encrypted_dek, &entry.nonce)
}

fn read_v1_file(path: &Path) -> Result<V1VaultFile, String> {
    let data = std::fs::read(path).map_err(|e| format!("Failed to read vault file: {}", e))?;

    if let Ok(vault) = serde_json::from_slice::<V1VaultFile>(&data) {
        return Ok(vault);
    }

    let legacy: V1LegacyVaultFile = serde_json::from_slice(&data)
        .map_err(|e| format!("Failed to parse vault file: {}", e))?;

    let mut methods = HashMap::new();
    methods.insert(
        "password".to_string(),
        WrappedKey {
            salt: legacy.salt,
            nonce: legacy.nonce,
            encrypted_dek: legacy.encrypted_dek,
        },
    );

    Ok(V1VaultFile { methods })
}

fn read_v2_file(path: &Path) -> Result<V2VaultFile, String> {
    let data = std::fs::read(path).map_err(|e| format!("Failed to read vault file: {}", e))?;
    serde_json::from_slice::<V2VaultFile>(&data)
        .map_err(|e| format!("Failed to parse v2 vault file: {}", e))
}

// Atomic write: stage to a sibling .tmp file, fsync, then rename over the
// target. On Windows std::fs::rename uses MoveFileExW with REPLACE_EXISTING,
// so the rename itself is atomic on the same volume. This guards the
// migration path: a crash mid-rewrite leaves either the original v1 file
// intact or the fully-written v2 file in place — never a truncated file
// that parses as neither.
fn write_v2_file(path: &Path, dek: &[u8; 32]) -> Result<(), String> {
    let file = V2VaultFile {
        version: 2,
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

/// Return the on-disk format version of the user's vault. The caller should
/// ensure the file exists (via `vault_exists`) before calling.
pub fn read_vault_version(app_data_dir: &Path, user_id: &str) -> Result<VaultVersion, String> {
    let path = vault_path(app_data_dir, user_id);
    let data = std::fs::read(&path).map_err(|e| format!("Failed to read vault file: {}", e))?;

    // v2 files declare `version: 2` explicitly. Anything else (the two v1
    // shapes, both lacking a `version` field) is treated as v1.
    if let Ok(v2) = serde_json::from_slice::<V2VaultFile>(&data) {
        if v2.version == 2 {
            return Ok(VaultVersion::V2);
        }
    }
    Ok(VaultVersion::V1)
}

/// Verify that the supplied DEK matches the on-disk v2 vault's fingerprint.
/// Returns Ok(()) on match. Used to defend against the case where the
/// keyring DEK is valid but the vault file (or DB it points at) belongs to
/// a different vault — without this check SQLCipher would silently create
/// an empty DB on a freshly missing `messages_<user_id>.db`.
pub fn verify_v2_fingerprint(
    app_data_dir: &Path,
    user_id: &str,
    dek: &[u8; 32],
) -> Result<(), String> {
    let path = vault_path(app_data_dir, user_id);
    let v2 = read_v2_file(&path)?;
    if v2.dek_fp != fingerprint_dek(dek) {
        return Err("DEK does not match vault fingerprint".to_string());
    }
    Ok(())
}

/// Create a fresh v2 vault: random DEK + on-disk version marker + DEK
/// fingerprint. The DEK is returned to the caller, which is responsible for
/// stashing it in the keyring (via session_save) and mounting the encrypted
/// DB.
pub fn create_vault_v2(
    app_data_dir: &Path,
    user_id: &str,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    rand::thread_rng().fill_bytes(dek.as_mut());

    let path = vault_path(app_data_dir, user_id);
    write_v2_file(&path, &dek)?;
    Ok(dek)
}

/// Convert a v1 vault to v2 by overwriting its file with the v2 marker plus
/// a fingerprint of the supplied (already-unwrapped) DEK. The DEK is
/// unchanged so SQLCipher continues to read existing rows; the caller is
/// responsible for stashing that DEK in the keyring.
pub fn rewrite_as_v2(app_data_dir: &Path, user_id: &str, dek: &[u8; 32]) -> Result<(), String> {
    let path = vault_path(app_data_dir, user_id);
    write_v2_file(&path, dek)
}

/// Unwrap a v1 vault using the user's login password. Used solely for the
/// one-time migration path; never called for new sign-ins.
pub fn open_v1_vault_with_password(
    app_data_dir: &Path,
    user_id: &str,
    password: &str,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let path = vault_path(app_data_dir, user_id);
    let vault = read_v1_file(&path)?;

    if let Some(entry) = vault.methods.get("password") {
        if let Ok(dek) = open_v1_with_password(entry, password) {
            return Ok(dek);
        }
    }
    // Older single-method vaults lived under "pin" but were always created
    // with the login password as the secret, so try that key too.
    if let Some(entry) = vault.methods.get("pin") {
        if let Ok(dek) = open_v1_with_password(entry, password) {
            return Ok(dek);
        }
    }
    Err("Invalid credentials".to_string())
}
