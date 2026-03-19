use crate::auth::SessionStore;
use crate::http_client;
use openmls::prelude::*;
use openmls::prelude::tls_codec::{Deserialize as TlsDeserializeTrait, Serialize as TlsSerializeTrait};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{command, Manager, State};

// ============================================
// STATE
// ============================================

pub struct MlsState {
    inner: Mutex<Option<MlsInner>>,
}

/// Serializable metadata persisted alongside the MLS key store
#[derive(Serialize, Deserialize, Default)]
struct MlsMetadata {
    conversation_groups: HashMap<String, Vec<u8>>,
    signer_public_key: Vec<u8>,
}

struct MlsInner {
    provider: OpenMlsRustCrypto,
    credential_with_key: CredentialWithKey,
    signer: SignatureKeyPair,
    /// group_id bytes -> MlsGroup
    groups: HashMap<Vec<u8>, MlsGroup>,
    /// conversation_id -> group_id bytes
    conversation_groups: HashMap<String, Vec<u8>>,
    /// Path to persist state
    storage_path: PathBuf,
}

impl MlsInner {
    fn save_state(&self) {
        if let Err(e) = self.provider.storage().save_to_file(
            &std::fs::File::create(&self.storage_path).unwrap(),
        ) {
            eprintln!("Failed to save MLS state: {}", e);
        }

        let meta = MlsMetadata {
            conversation_groups: self.conversation_groups.clone(),
            signer_public_key: self.signer.to_public_vec().to_vec(),
        };
        let meta_path = self.storage_path.with_extension("meta.json");
        if let Ok(file) = std::fs::File::create(&meta_path) {
            let _ = serde_json::to_writer(file, &meta);
        }
    }
}

impl Default for MlsState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

// ============================================
// SERVER RESPONSE TYPES
// ============================================

#[derive(Deserialize)]
struct KeyPackageCountResponse {
    count: i64,
}

#[derive(Serialize)]
struct UploadKeyPackagesBody {
    key_packages: Vec<Vec<u8>>,
}

#[derive(Deserialize)]
struct ClaimedKeyPackage {
    key_package_data: Vec<u8>,
}

#[derive(Serialize)]
struct RegisterGroupBody {
    group_id: Vec<u8>,
    conversation_id: String,
    member_ids: Vec<String>,
}

#[derive(Serialize)]
struct StoreWelcomeBody {
    recipient_id: String,
    group_id: Vec<u8>,
    welcome_data: Vec<u8>,
}

#[derive(Deserialize)]
struct WelcomeMessageResponse {
    #[allow(dead_code)]
    id: String,
    group_id: Vec<u8>,
    welcome_data: Vec<u8>,
    conversation_id: Option<String>,
}

#[derive(Serialize)]
struct FanOutCommitBody {
    group_id: Vec<u8>,
    commit_data: Vec<u8>,
}

// ============================================
// COMMANDS
// ============================================

#[command]
pub async fn mls_init(
    app_handle: tauri::AppHandle,
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<bool, String> {
    let user_id = {
        let store = session_store.session.lock().map_err(|e| e.to_string())?;
        match &*store {
            Some(session) => session.user_id.clone(),
            None => return Err("Not authenticated".to_string()),
        }
    };

    let app_data_dir = app_handle.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {:?}", e))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {:?}", e))?;

    let storage_path = app_data_dir.join(format!("mls_{}.json", user_id));

    // Load storage from file if it exists, then build provider
    let mut storage = openmls_memory_storage::MemoryStorage::default();
    if storage_path.exists() {
        if let Ok(file) = std::fs::File::open(&storage_path) {
            let _ = storage.load_from_file(&file);
        }
    }

    let provider = OpenMlsRustCrypto::default();
    // Copy loaded state into the provider's storage
    if storage_path.exists() {
        let loaded_values = storage.values.read().unwrap();
        let mut provider_values = provider.storage().values.write().unwrap();
        for (k, v) in loaded_values.iter() {
            provider_values.insert(k.clone(), v.clone());
        }
    }

    // Load metadata (conversation mappings + signer public key)
    let meta_path = storage_path.with_extension("meta.json");
    let metadata: MlsMetadata = if meta_path.exists() {
        std::fs::File::open(&meta_path)
            .ok()
            .and_then(|f| serde_json::from_reader(f).ok())
            .unwrap_or_default()
    } else {
        MlsMetadata::default()
    };

    let credential = BasicCredential::new(user_id.as_bytes().to_vec());

    // Try to reload existing signer, or generate a new one
    let signer = if !metadata.signer_public_key.is_empty() {
        SignatureKeyPair::read(
            provider.storage(),
            &metadata.signer_public_key,
            CIPHERSUITE.signature_algorithm(),
        ).unwrap_or_else(|| {
            let s = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).unwrap();
            s.store(provider.storage()).unwrap();
            s
        })
    } else {
        let s = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
            .map_err(|e| format!("Failed to generate signing key: {:?}", e))?;
        s.store(provider.storage())
            .map_err(|e| format!("Failed to store signing key: {:?}", e))?;
        s
    };

    let credential_with_key = CredentialWithKey {
        credential: credential.into(),
        signature_key: signer.to_public_vec().into(),
    };

    // Reload groups from storage
    let mut groups = HashMap::new();
    for group_id_bytes in metadata.conversation_groups.values() {
        let group_id = GroupId::from_slice(group_id_bytes);
        if let Ok(Some(group)) = MlsGroup::load(provider.storage(), &group_id) {
            groups.insert(group_id_bytes.to_vec(), group);
        }
    }

    let inner = MlsInner {
        provider,
        credential_with_key,
        signer,
        groups,
        conversation_groups: metadata.conversation_groups,
        storage_path,
    };

    let mut state = mls_state.inner.lock().map_err(|e| e.to_string())?;
    *state = Some(inner);

    Ok(true)
}

#[command]
pub async fn mls_upload_key_packages(
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<u32, String> {
    let count = 50u32;

    let serialized_packages = {
        let mut state = mls_state.inner.lock().map_err(|e| e.to_string())?;
        let inner = state.as_mut().ok_or("MLS not initialized")?;

        let mut packages = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let kp_bundle = KeyPackage::builder()
                .build(
                    CIPHERSUITE, &inner.provider, &inner.signer,
                    inner.credential_with_key.clone(),
                )
                .map_err(|e| format!("Failed to create key package: {:?}", e))?;

            let serialized = kp_bundle.key_package()
                .tls_serialize_detached()
                .map_err(|e| format!("Failed to serialize key package: {:?}", e))?;
            packages.push(serialized);
        }

        inner.save_state();
        packages
    };

    let token = get_token(&session_store)?;
    let body = UploadKeyPackagesBody { key_packages: serialized_packages };
    let _: serde_json::Value = http_client::post("/mls/key-packages", &token, &body).await?;

    Ok(count)
}

#[command]
pub async fn mls_check_key_packages(
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<i64, String> {
    let token = get_token(&session_store)?;
    let resp: KeyPackageCountResponse =
        http_client::get("/mls/key-packages/count", &token).await?;

    if resp.count < 10 {
        mls_upload_key_packages(mls_state, session_store).await?;
    }

    Ok(resp.count)
}

#[command]
pub async fn mls_create_group(
    conversation_id: String,
    other_user_id: String,
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<bool, String> {
    create_group_inner(&conversation_id, &other_user_id, &mls_state, &session_store).await
}

#[command]
pub async fn mls_encrypt_message(
    conversation_id: String,
    plaintext: String,
    mls_state: State<'_, MlsState>,
) -> Result<Vec<u8>, String> {
    encrypt_message_inner(&mls_state, &conversation_id, &plaintext)
}

#[command]
pub async fn mls_decrypt_message(
    conversation_id: String,
    ciphertext: Vec<u8>,
    mls_state: State<'_, MlsState>,
) -> Result<String, String> {
    decrypt_message_inner(&mls_state, &conversation_id, &ciphertext)
}

#[command]
pub async fn mls_fetch_welcomes(
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<u32, String> {
    fetch_welcomes_inner(&mls_state, &session_store).await
}

#[command]
pub async fn mls_has_group(
    conversation_id: String,
    mls_state: State<'_, MlsState>,
) -> Result<bool, String> {
    Ok(has_group_inner(&mls_state, &conversation_id))
}

// ============================================
// PUBLIC HELPERS (called from conversations.rs)
// ============================================

pub async fn create_group_inner(
    conversation_id: &str,
    other_user_id: &str,
    mls_state: &State<'_, MlsState>,
    session_store: &State<'_, SessionStore>,
) -> Result<bool, String> {
    let token = get_token(session_store)?;
    let my_user_id = get_user_id_from_session(session_store)?;

    let claimed: ClaimedKeyPackage = http_client::get(
        &format!("/mls/key-packages/{}", other_user_id), &token,
    ).await?;

    let (group_id_bytes, welcome_bytes, commit_bytes) = {
        let mut state = mls_state.inner.lock().map_err(|e| e.to_string())?;
        let inner = state.as_mut().ok_or("MLS not initialized")?;

        let key_package_in = KeyPackageIn::tls_deserialize(
            &mut claimed.key_package_data.as_slice(),
        ).map_err(|e| format!("Failed to deserialize key package: {:?}", e))?;

        let validated_kp = key_package_in
            .validate(inner.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(|e| format!("Failed to validate key package: {:?}", e))?;

        let group_config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .build();

        let group_id = GroupId::from_slice(&uuid::Uuid::new_v4().as_bytes()[..]);

        let mut group = MlsGroup::new_with_group_id(
            &inner.provider, &inner.signer, &group_config,
            group_id, inner.credential_with_key.clone(),
        ).map_err(|e| format!("Failed to create MLS group: {:?}", e))?;

        let (commit, welcome, _) = group
            .add_members(&inner.provider, &inner.signer, &[validated_kp])
            .map_err(|e| format!("Failed to add member: {:?}", e))?;

        group.merge_pending_commit(&inner.provider)
            .map_err(|e| format!("Failed to merge commit: {:?}", e))?;

        let gid = group.group_id().as_slice().to_vec();
        let wb = welcome.tls_serialize_detached()
            .map_err(|e| format!("Failed to serialize welcome: {:?}", e))?;
        let cb = commit.tls_serialize_detached()
            .map_err(|e| format!("Failed to serialize commit: {:?}", e))?;

        inner.conversation_groups.insert(conversation_id.to_string(), gid.clone());
        inner.groups.insert(gid.clone(), group);
        inner.save_state();

        (gid, wb, cb)
    };

    let register_body = RegisterGroupBody {
        group_id: group_id_bytes.clone(),
        conversation_id: conversation_id.to_string(),
        member_ids: vec![my_user_id, other_user_id.to_string()],
    };
    let _: serde_json::Value =
        http_client::post("/mls/groups", &token, &register_body).await?;

    let welcome_body = StoreWelcomeBody {
        recipient_id: other_user_id.to_string(),
        group_id: group_id_bytes.clone(),
        welcome_data: welcome_bytes,
    };
    let _: serde_json::Value =
        http_client::post("/mls/welcome", &token, &welcome_body).await?;

    let commit_body = FanOutCommitBody {
        group_id: group_id_bytes,
        commit_data: commit_bytes,
    };
    let _: serde_json::Value =
        http_client::post("/mls/commit", &token, &commit_body).await?;

    Ok(true)
}

pub fn has_group_inner(mls_state: &State<'_, MlsState>, conversation_id: &str) -> bool {
    let state = match mls_state.inner.lock() {
        Ok(s) => s,
        Err(_) => return false,
    };
    match state.as_ref() {
        Some(inner) => inner.conversation_groups.contains_key(conversation_id),
        None => false,
    }
}

pub fn encrypt_message_inner(
    mls_state: &State<'_, MlsState>,
    conversation_id: &str,
    plaintext: &str,
) -> Result<Vec<u8>, String> {
    let mut state = mls_state.inner.lock().map_err(|e| e.to_string())?;
    let inner = state.as_mut().ok_or("MLS not initialized")?;

    let group_id = inner.conversation_groups.get(conversation_id)
        .ok_or("No MLS group for this conversation")?.clone();

    let group = inner.groups.get_mut(&group_id)
        .ok_or("MLS group not found in local state")?;

    let ciphertext = group
        .create_message(&inner.provider, &inner.signer, plaintext.as_bytes())
        .map_err(|e| format!("Failed to encrypt message: {:?}", e))?;

    inner.save_state();

    ciphertext.tls_serialize_detached()
        .map_err(|e| format!("Failed to serialize ciphertext: {:?}", e))
}

pub fn decrypt_message_inner(
    mls_state: &State<'_, MlsState>,
    conversation_id: &str,
    ciphertext: &[u8],
) -> Result<String, String> {
    let mut state = mls_state.inner.lock().map_err(|e| e.to_string())?;
    let inner = state.as_mut().ok_or("MLS not initialized")?;

    let group_id = inner.conversation_groups.get(conversation_id)
        .ok_or("No MLS group for this conversation")?.clone();

    let group = inner.groups.get_mut(&group_id)
        .ok_or("MLS group not found in local state")?;

    let mls_message = MlsMessageIn::tls_deserialize(&mut &ciphertext[..])
        .map_err(|e| format!("Failed to deserialize MLS message: {:?}", e))?;

    let protocol_message: ProtocolMessage = mls_message
        .try_into_protocol_message()
        .map_err(|e| format!("Not a protocol message: {:?}", e))?;

    let processed = group
        .process_message(&inner.provider, protocol_message)
        .map_err(|e| format!("Failed to process message: {:?}", e))?;

    inner.save_state();

    match processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(app_msg) => {
            String::from_utf8(app_msg.into_bytes())
                .map_err(|e| format!("Invalid UTF-8 in decrypted message: {}", e))
        }
        _ => Err("Not an application message".to_string()),
    }
}

pub async fn fetch_welcomes_inner(
    mls_state: &State<'_, MlsState>,
    session_store: &State<'_, SessionStore>,
) -> Result<u32, String> {
    let token = get_token(session_store)?;

    let welcomes: Vec<WelcomeMessageResponse> =
        http_client::get("/mls/welcome", &token).await?;

    if welcomes.is_empty() {
        return Ok(0);
    }

    let mut count = 0u32;
    for welcome_msg in &welcomes {
        match process_welcome_inner(mls_state, &welcome_msg.welcome_data, welcome_msg.conversation_id.as_deref()) {
            Ok(_) => {
                // Send ACK to server so queued messages can be released
                let ack_body = serde_json::json!({ "group_id": welcome_msg.group_id });
                let _ = http_client::post::<serde_json::Value, _>(
                    "/mls/welcome-ack", &token, &ack_body,
                ).await;
                count += 1;
            }
            Err(e) => eprintln!("Failed to process welcome: {}", e),
        }
    }

    Ok(count)
}

// ============================================
// PRIVATE HELPERS
// ============================================

fn process_welcome_inner(
    mls_state: &State<'_, MlsState>,
    welcome_data: &[u8],
    conversation_id: Option<&str>,
) -> Result<(), String> {
    let mut state = mls_state.inner.lock().map_err(|e| e.to_string())?;
    let inner = state.as_mut().ok_or("MLS not initialized")?;

    let mls_msg_in = MlsMessageIn::tls_deserialize(&mut &welcome_data[..])
        .map_err(|e| format!("Failed to deserialize welcome: {:?}", e))?;

    let welcome = mls_msg_in.into_welcome()
        .ok_or("Message is not a Welcome")?;

    let group_config = MlsGroupJoinConfig::builder().build();

    let group = StagedWelcome::new_from_welcome(
        &inner.provider, &group_config, welcome, None,
    )
    .map_err(|e| format!("Failed to stage welcome: {:?}", e))?
    .into_group(&inner.provider)
    .map_err(|e| format!("Failed to join group from welcome: {:?}", e))?;

    let group_id = group.group_id().as_slice().to_vec();

    // Map conversation_id to this group so we can decrypt messages
    if let Some(conv_id) = conversation_id {
        inner.conversation_groups.insert(conv_id.to_string(), group_id.clone());
    }

    inner.groups.insert(group_id, group);
    inner.save_state();

    Ok(())
}

fn get_token(session_store: &State<'_, SessionStore>) -> Result<String, String> {
    let store = session_store.session.lock().map_err(|e| e.to_string())?;
    match &*store {
        Some(session) if chrono::Utc::now().timestamp() < session.expires_at => {
            Ok(session.access_token.clone())
        }
        Some(_) => Err("Session expired".to_string()),
        None => Err("Not authenticated".to_string()),
    }
}

fn get_user_id_from_session(session_store: &State<'_, SessionStore>) -> Result<String, String> {
    let store = session_store.session.lock().map_err(|e| e.to_string())?;
    match &*store {
        Some(session) => Ok(session.user_id.clone()),
        None => Err("Not authenticated".to_string()),
    }
}
