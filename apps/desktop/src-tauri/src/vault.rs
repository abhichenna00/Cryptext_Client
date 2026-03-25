// src-tauri/src/vault.rs
//
// DEK/KEK key management for SQLCipher encryption.
// The DEK (Data Encryption Key) encrypts the database.
// The KEK (Key Encryption Key) is derived from the user's PIN via Argon2id and wraps the DEK.
// The .vault file stores {salt, nonce, tag, encrypted_dek} — useless without the PIN.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Argon2, Algorithm, Version, Params};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const ARGON2_M_COST: u32 = 65536; // 64 MiB
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 4;
const DEK_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize)]
struct VaultFile {
    salt: Vec<u8>,
    nonce: Vec<u8>,
    encrypted_dek: Vec<u8>,
}

fn derive_kek(pin: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST, Some(32))
        .map_err(|e| format!("Invalid Argon2 params: {}", e))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut kek = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(pin, salt, kek.as_mut())
        .map_err(|e| format!("Argon2 derivation failed: {}", e))?;

    Ok(kek)
}

fn wrap_dek(kek: &[u8; 32], dek: &[u8; 32], nonce_bytes: &[u8; NONCE_LEN]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(kek)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .encrypt(nonce, dek.as_ref())
        .map_err(|e| format!("Failed to encrypt DEK: {}", e))
}

fn unwrap_dek(kek: &[u8; 32], encrypted_dek: &[u8], nonce_bytes: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let cipher = Aes256Gcm::new_from_slice(kek)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let decrypted = cipher
        .decrypt(nonce, encrypted_dek)
        .map_err(|_| "Invalid PIN".to_string())?;

    if decrypted.len() != DEK_LEN {
        return Err("Decrypted DEK has wrong length".to_string());
    }

    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&decrypted);
    Ok(dek)
}

pub fn vault_path(app_data_dir: &Path, user_id: &str) -> PathBuf {
    app_data_dir.join(format!("{}.vault", user_id))
}

pub fn vault_exists(app_data_dir: &Path, user_id: &str) -> bool {
    vault_path(app_data_dir, user_id).exists()
}

/// Create a new vault: generate random DEK, wrap with PIN-derived KEK, save to disk.
/// Returns the raw DEK for opening SQLCipher.
pub fn create_vault(app_data_dir: &Path, user_id: &str, pin: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];

    let mut rng = rand::thread_rng();
    rng.fill_bytes(dek.as_mut());
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    let kek = derive_kek(pin.as_bytes(), &salt)?;
    let encrypted_dek = wrap_dek(&kek, &dek, &nonce_bytes)?;

    let vault = VaultFile {
        salt: salt.to_vec(),
        nonce: nonce_bytes.to_vec(),
        encrypted_dek,
    };

    let path = vault_path(app_data_dir, user_id);
    let file = std::fs::File::create(&path)
        .map_err(|e| format!("Failed to create vault file: {}", e))?;
    serde_json::to_writer(file, &vault)
        .map_err(|e| format!("Failed to write vault file: {}", e))?;

    Ok(dek)
}

/// Open an existing vault: derive KEK from PIN, unwrap DEK, return it.
pub fn open_vault(app_data_dir: &Path, user_id: &str, pin: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let path = vault_path(app_data_dir, user_id);
    let file = std::fs::File::open(&path)
        .map_err(|e| format!("Failed to open vault file: {}", e))?;
    let vault: VaultFile = serde_json::from_reader(file)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;

    let kek = derive_kek(pin.as_bytes(), &vault.salt)?;
    unwrap_dek(&kek, &vault.encrypted_dek, &vault.nonce)
}

/// Change the PIN: unwrap DEK with old PIN, re-wrap with new PIN, overwrite vault file.
pub fn change_pin(app_data_dir: &Path, user_id: &str, old_pin: &str, new_pin: &str) -> Result<(), String> {
    let dek = open_vault(app_data_dir, user_id, old_pin)?;

    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    let mut rng = rand::thread_rng();
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    let kek = derive_kek(new_pin.as_bytes(), &salt)?;
    let encrypted_dek = wrap_dek(&kek, &dek, &nonce_bytes)?;

    let vault = VaultFile {
        salt: salt.to_vec(),
        nonce: nonce_bytes.to_vec(),
        encrypted_dek,
    };

    let path = vault_path(app_data_dir, user_id);
    let file = std::fs::File::create(&path)
        .map_err(|e| format!("Failed to create vault file: {}", e))?;
    serde_json::to_writer(file, &vault)
        .map_err(|e| format!("Failed to write vault file: {}", e))?;

    Ok(())
}
