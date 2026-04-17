// src-tauri/src/vault.rs
//
// Multi-method DEK/KEK key management for SQLCipher encryption.
//
// The DEK (Data Encryption Key) encrypts the database and MLS state.
// Multiple unlock methods can independently wrap the same DEK:
//   - "password" (primary) — derived from login password via Argon2id. Used for
//     server-side sync/recovery. Always present.
//   - "pin" (convenience) — derived from a short numeric PIN. Local-only fast unlock.
//   - "biometric" (future) — OS-provided biometric key wraps the DEK.
//
// The .vault file stores one entry per method, each with its own salt/nonce/ciphertext.
// None of these entries are useful without the corresponding secret.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Argon2, Algorithm, Version, Params};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const ARGON2_M_COST: u32 = 65536; // 64 MiB
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 4;
const DEK_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize, Clone)]
pub struct WrappedKey {
    salt: Vec<u8>,
    nonce: Vec<u8>,
    encrypted_dek: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct VaultFile {
    methods: HashMap<String, WrappedKey>,
}

#[derive(Serialize, Deserialize)]
struct LegacyVaultFile {
    salt: Vec<u8>,
    nonce: Vec<u8>,
    encrypted_dek: Vec<u8>,
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
        .map_err(|_| "Invalid credentials".to_string())?;

    if decrypted.len() != DEK_LEN {
        return Err("Decrypted DEK has wrong length".to_string());
    }

    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&decrypted);
    Ok(dek)
}

fn create_wrapped_key(secret: &[u8], dek: &[u8; 32]) -> Result<WrappedKey, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    let mut rng = rand::thread_rng();
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    let kek = derive_kek(secret, &salt)?;
    let encrypted_dek = wrap_dek(&kek, dek, &nonce_bytes)?;

    Ok(WrappedKey {
        salt: salt.to_vec(),
        nonce: nonce_bytes.to_vec(),
        encrypted_dek,
    })
}

fn open_with_method(entry: &WrappedKey, secret: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let kek = derive_kek(secret, &entry.salt)?;
    unwrap_dek(&kek, &entry.encrypted_dek, &entry.nonce)
}

fn read_vault(path: &Path) -> Result<VaultFile, String> {
    let data = std::fs::read(path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;

    if let Ok(vault) = serde_json::from_slice::<VaultFile>(&data) {
        return Ok(vault);
    }

    // Migrate legacy single-method format. The old vault was created with the
    // login password (passed as "pin"), so the entry belongs under "password".
    let legacy: LegacyVaultFile = serde_json::from_slice(&data)
        .map_err(|e| format!("Failed to parse vault file: {}", e))?;

    let mut methods = HashMap::new();
    methods.insert("password".to_string(), WrappedKey {
        salt: legacy.salt,
        nonce: legacy.nonce,
        encrypted_dek: legacy.encrypted_dek,
    });

    let vault = VaultFile { methods };

    let file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to migrate vault file: {}", e))?;
    serde_json::to_writer(file, &vault)
        .map_err(|e| format!("Failed to write migrated vault: {}", e))?;

    Ok(vault)
}

fn write_vault(path: &Path, vault: &VaultFile) -> Result<(), String> {
    let file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to create vault file: {}", e))?;
    serde_json::to_writer(file, vault)
        .map_err(|e| format!("Failed to write vault file: {}", e))?;
    Ok(())
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

/// Create a new vault with password as the primary unlock method.
/// Returns the raw DEK for opening SQLCipher.
pub fn create_vault(app_data_dir: &Path, user_id: &str, password: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    rand::thread_rng().fill_bytes(dek.as_mut());

    let password_entry = create_wrapped_key(password.as_bytes(), &dek)?;

    let mut methods = HashMap::new();
    methods.insert("password".to_string(), password_entry);

    let vault = VaultFile { methods };
    let path = vault_path(app_data_dir, user_id);
    write_vault(&path, &vault)?;

    Ok(dek)
}

/// Open vault using the login password.
pub fn open_vault_with_password(app_data_dir: &Path, user_id: &str, password: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let path = vault_path(app_data_dir, user_id);
    let vault = read_vault(&path)?;

    let entry = vault.methods.get("password")
        .ok_or_else(|| "No password unlock method in vault".to_string())?;

    open_with_method(entry, password.as_bytes())
}

/// Open vault with any available method. Tries password first, then falls
/// back to any other registered method. Today that's just the password
/// entry — this shape is kept so the legacy-migration path from `read_vault`
/// keeps working when it rewrites older single-method vault files.
pub fn open_vault(app_data_dir: &Path, user_id: &str, secret: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let path = vault_path(app_data_dir, user_id);
    let vault = read_vault(&path)?;

    for method in &["password", "pin"] {
        if let Some(entry) = vault.methods.get(*method) {
            if let Ok(dek) = open_with_method(entry, secret.as_bytes()) {
                return Ok(dek);
            }
        }
    }

    Err("Invalid credentials".to_string())
}

/// Change the password: unwrap DEK with old password, re-wrap with new password.
pub fn change_password(app_data_dir: &Path, user_id: &str, old_password: &str, new_password: &str) -> Result<(), String> {
    let dek = open_vault_with_password(app_data_dir, user_id, old_password)?;

    let path = vault_path(app_data_dir, user_id);
    let mut vault = read_vault(&path)?;

    let new_entry = create_wrapped_key(new_password.as_bytes(), &dek)?;
    vault.methods.insert("password".to_string(), new_entry);

    write_vault(&path, &vault)
}
