use crate::auth::{self, SessionStore};
use crate::http_client::AuthorizedClient;
use crate::local_db::LocalDb;
use crate::sync;
use crate::sync_utils::MutexExt;
use openmls::prelude::*;
use openmls::prelude::tls_codec::{Deserialize as TlsDeserializeTrait, Serialize as TlsSerializeTrait};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{command, Manager, State};
use zeroize::Zeroizing;

// ============================================
// STATE
// ============================================

pub struct MlsState {
    inner: Mutex<Option<MlsInner>>,
    /// Per-conversation async locks. Held across the entire fetch → decrypt →
    /// store sequence so two concurrent callers (StrictMode double-mount in
    /// dev, or a WebSocket push overlapping a manual refresh in prod) cannot
    /// both attempt to decrypt the same ciphertext and trip SecretReuseError.
    conversation_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
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
    /// DEK held while the vault is unlocked, used to encrypt state on disk.
    dek: Zeroizing<[u8; 32]>,
}

// 4-byte magic prefix marking the encrypted MLS file format. Anything not
// starting with this is treated as the legacy plaintext layout and migrated.
const MLS_FILE_MAGIC: &[u8; 4] = b"MLS1";

impl MlsInner {
    fn save_state(&self) -> Result<(), String> {
        let storage_bytes = Zeroizing::new(serialize_storage(self.provider.storage())?);
        write_encrypted(&self.storage_path, &self.dek, &storage_bytes)?;

        let meta = MlsMetadata {
            conversation_groups: self.conversation_groups.clone(),
            signer_public_key: self.signer.to_public_vec().to_vec(),
        };
        let meta_bytes = Zeroizing::new(
            serde_json::to_vec(&meta)
                .map_err(|e| format!("Failed to serialize MLS metadata: {}", e))?,
        );
        let meta_path = meta_path_for(&self.storage_path);
        write_encrypted(&meta_path, &self.dek, &meta_bytes)?;

        Ok(())
    }
}

impl Default for MlsState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            conversation_locks: Mutex::new(HashMap::new()),
        }
    }
}

impl MlsState {
    /// Get (or lazily create) the async lock guarding a conversation's
    /// fetch → decrypt → store sequence. Callers must hold the returned
    /// guard for the entire sequence.
    pub fn conversation_lock(
        &self,
        conversation_id: &str,
    ) -> Result<Arc<tokio::sync::Mutex<()>>, String> {
        let mut map = self.conversation_locks.lock_or_err()?;
        Ok(map
            .entry(conversation_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone())
    }
}

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

// ============================================
// ON-DISK ENCRYPTION HELPERS
// ============================================

fn meta_path_for(state_path: &Path) -> PathBuf {
    state_path.with_extension("meta.json")
}

/// Serialize a MemoryStorage instance into the same JSON+base64 layout
/// produced by `MemoryStorage::save_to_file`, but into an in-memory buffer.
/// Required so we can hand the plaintext to AEAD without ever touching disk.
fn serialize_storage(
    storage: &openmls_memory_storage::MemoryStorage,
) -> Result<Vec<u8>, String> {
    use base64::Engine;
    #[derive(Serialize)]
    struct SerializableKeyStore {
        values: HashMap<String, String>,
    }
    let values = storage
        .values
        .read()
        .map_err(|e| format!("MLS storage read lock poisoned: {}", e))?;
    let engine = base64::engine::general_purpose::STANDARD;
    let mut ser = SerializableKeyStore {
        values: HashMap::with_capacity(values.len()),
    };
    for (k, v) in values.iter() {
        ser.values.insert(engine.encode(k), engine.encode(v));
    }
    serde_json::to_vec(&ser).map_err(|e| format!("Failed to serialize MLS storage: {}", e))
}

fn deserialize_storage_into(
    bytes: &[u8],
    storage: &openmls_memory_storage::MemoryStorage,
) -> Result<(), String> {
    use base64::Engine;
    #[derive(Deserialize)]
    struct SerializableKeyStore {
        values: HashMap<String, String>,
    }
    let ser: SerializableKeyStore = serde_json::from_slice(bytes)
        .map_err(|e| format!("Failed to parse MLS storage: {}", e))?;
    let engine = base64::engine::general_purpose::STANDARD;
    let mut values = storage
        .values
        .write()
        .map_err(|e| format!("MLS storage write lock poisoned: {}", e))?;
    for (k, v) in ser.values {
        let key = engine
            .decode(&k)
            .map_err(|e| format!("Failed to decode MLS storage key: {}", e))?;
        let val = engine
            .decode(&v)
            .map_err(|e| format!("Failed to decode MLS storage value: {}", e))?;
        values.insert(key, val);
    }
    Ok(())
}

fn write_encrypted(path: &Path, dek: &[u8; 32], plaintext: &[u8]) -> Result<(), String> {
    let encrypted = sync::encrypt_with_dek(dek, plaintext)?;
    let mut buf = Vec::with_capacity(MLS_FILE_MAGIC.len() + encrypted.len());
    buf.extend_from_slice(MLS_FILE_MAGIC);
    buf.extend_from_slice(&encrypted);

    let tmp_path = path.with_extension("tmp");
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        file.write_all(&buf)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync temp file: {}", e))?;
    }
    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to rename temp file: {}", e))?;
    Ok(())
}

fn read_encrypted(path: &Path, dek: &[u8; 32]) -> Result<Zeroizing<Vec<u8>>, String> {
    let raw = std::fs::read(path).map_err(|e| format!("Failed to read MLS file: {}", e))?;
    if raw.len() < MLS_FILE_MAGIC.len() || &raw[..MLS_FILE_MAGIC.len()] != MLS_FILE_MAGIC {
        return Err("LEGACY_PLAINTEXT".to_string());
    }
    let plaintext = sync::decrypt_with_dek(dek, &raw[MLS_FILE_MAGIC.len()..])?;
    Ok(Zeroizing::new(plaintext))
}

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

#[derive(Deserialize)]
struct RegisterGroupResponse {
    success: bool,
    #[allow(dead_code)]
    error: Option<String>,
    existing_group_id: Option<Vec<u8>>,
}

/// Outcome of attempting to register a new MLS group server-side. Either the
/// server accepted the new group, or another participant won the race and the
/// caller needs to recover by joining the existing group.
pub enum CreateGroupOutcome {
    /// New group registered. Embed `welcome_bytes` in the first message.
    NewGroup(Vec<u8>),
    /// Group already existed server-side. Caller should fetch messages /
    /// welcomes for this conversation to join the existing group, then resend.
    AlreadyExists,
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
// MLSSTATE — OPERATIONS
// ============================================

impl MlsState {
    /// Initialise the in-memory MLS provider from disk. Loads the encrypted
    /// keystore + metadata, reconstructs the signer, and rehydrates known
    /// groups. Returns true if a fresh signer was generated (caller should
    /// upload new key packages).
    pub async fn init(
        &self,
        app_handle: &tauri::AppHandle,
        session_store: &State<'_, SessionStore>,
        local_db: &State<'_, LocalDb>,
    ) -> Result<bool, String> {
        let user_id = {
            let store = session_store.session.lock_or_err()?;
            match &*store {
                Some(session) => session.user_id.clone(),
                None => return Err("Not authenticated".to_string()),
            }
        };

        // MLS state must be encrypted with the DEK, so the vault must be unlocked
        // before init runs. Mirrors the gating used by sync.rs / local_db.rs.
        let dek = sync::get_dek(local_db)?;

        let app_data_dir = app_handle.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {:?}", e))?;
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data dir: {:?}", e))?;

        let storage_path = app_data_dir.join(format!("mls_{}.json", user_id));
        let meta_path = meta_path_for(&storage_path);

        let provider = OpenMlsRustCrypto::default();

        // Refuse to load legacy plaintext MLS state files. An on-disk MLS
        // state could otherwise be arbitrarily modified before the user
        // re-signs-in, and we'd load attacker-controlled bytes straight
        // into the OpenMLS provider. Users still on the legacy layout can
        // recover by signing out and signing back in.
        if storage_path.exists() {
            match read_encrypted(&storage_path, &dek) {
                Ok(plaintext) => {
                    deserialize_storage_into(&plaintext, provider.storage())?;
                }
                Err(e) if e == "LEGACY_PLAINTEXT" => {
                    return Err(
                        "Local encryption state is in an unsupported legacy format. Please sign out and sign back in.".to_string(),
                    );
                }
                Err(e) => return Err(e),
            }
        }

        let metadata: MlsMetadata = if meta_path.exists() {
            match read_encrypted(&meta_path, &dek) {
                Ok(plaintext) => serde_json::from_slice(&plaintext)
                    .map_err(|e| format!("Failed to parse MLS metadata: {}", e))?,
                Err(e) if e == "LEGACY_PLAINTEXT" => {
                    return Err(
                        "Local encryption state is in an unsupported legacy format. Please sign out and sign back in.".to_string(),
                    );
                }
                Err(e) => return Err(e),
            }
        } else {
            MlsMetadata::default()
        };

        let credential = BasicCredential::new(user_id.as_bytes().to_vec());

        // Try to reload existing signer, or generate a new one
        let mut signer_regenerated = false;
        let signer = if !metadata.signer_public_key.is_empty() {
            match SignatureKeyPair::read(
                provider.storage(),
                &metadata.signer_public_key,
                CIPHERSUITE.signature_algorithm(),
            ) {
                Some(s) => s,
                None => {
                    eprintln!("[MLS] Signer reload failed, generating new signer");
                    signer_regenerated = true;
                    let s = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).unwrap();
                    s.store(provider.storage()).unwrap();
                    s
                }
            }
        } else {
            signer_regenerated = true;
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

        let mut dek_copy = [0u8; 32];
        dek_copy.copy_from_slice(&*dek);
        let inner = MlsInner {
            provider,
            credential_with_key,
            signer,
            groups,
            conversation_groups: metadata.conversation_groups,
            storage_path,
            dek: Zeroizing::new(dek_copy),
        };


        let mut state = self.inner.lock_or_err()?;
        *state = Some(inner);

        Ok(signer_regenerated)
    }

    /// Build 50 fresh key packages, persist locally, and upload to the server
    /// so other users can claim them when starting a new conversation.
    pub async fn upload_key_packages(
        &self,
        session_store: &State<'_, SessionStore>,
    ) -> Result<u32, String> {
        let count = 50u32;

        let serialized_packages = {
            let mut state = self.inner.lock_or_err()?;
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

            inner.save_state()?;
            packages
        };

        let client = AuthorizedClient::from_session(session_store)?;
        let body = UploadKeyPackagesBody { key_packages: serialized_packages };
        let _: serde_json::Value = client.post("/mls/key-packages", &body).await?;

        Ok(count)
    }

    /// Tell the server to clear out our stored key packages. Used when a fresh
    /// signer has been generated and the old packages are no longer usable.
    pub async fn delete_key_packages(
        &self,
        session_store: &State<'_, SessionStore>,
    ) -> Result<bool, String> {
        let client = AuthorizedClient::from_session(session_store)?;
        let _: serde_json::Value = client.delete("/mls/key-packages").await?;
        Ok(true)
    }

    /// Check the server's count of our key packages. If it's below the
    /// replenish threshold, automatically top up.
    pub async fn check_key_packages(
        &self,
        session_store: &State<'_, SessionStore>,
    ) -> Result<i64, String> {
        let client = AuthorizedClient::from_session(session_store)?;
        let resp: KeyPackageCountResponse =
            client.get("/mls/key-packages/count").await?;

        if resp.count < 10 {
            self.upload_key_packages(session_store).await?;
        }

        Ok(resp.count)
    }

    /// Create a new MLS group for a DM and register it with the server.
    /// Returns the welcome bytes to embed in the first message, or signals
    /// AlreadyExists if another participant won the registration race.
    pub async fn create_group(
        &self,
        conversation_id: &str,
        other_user_id: &str,
        session_store: &State<'_, SessionStore>,
    ) -> Result<CreateGroupOutcome, String> {
        log::info!("create_group: starting for conv={} other={}", conversation_id, other_user_id);
        let client = AuthorizedClient::from_session(session_store)?;
        let my_user_id = auth::get_user_id_from_session(session_store)?;

        let claimed: ClaimedKeyPackage = client.get(
            &format!("/mls/key-packages/{}", other_user_id),
        ).await?;

        let (group_id_bytes, welcome_bytes, commit_bytes) = {
            let mut state = self.inner.lock_or_err()?;
            let inner = state.as_mut().ok_or("MLS not initialized")?;

            let key_package_in = KeyPackageIn::tls_deserialize(
                &mut claimed.key_package_data.as_slice(),
            ).map_err(|e| format!("Failed to deserialize key package: {:?}", e))?;

            let validated_kp = key_package_in
                .validate(inner.provider.crypto(), ProtocolVersion::Mls10)
                .map_err(|e| format!("Failed to validate key package: {:?}", e))?;

            let group_config = MlsGroupCreateConfig::builder()
                .ciphersuite(CIPHERSUITE)
                .use_ratchet_tree_extension(true)
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
            inner.save_state()?;

            (gid, wb, cb)
        };

        let register_body = RegisterGroupBody {
            group_id: group_id_bytes.clone(),
            conversation_id: conversation_id.to_string(),
            member_ids: vec![my_user_id, other_user_id.to_string()],
        };
        let response: RegisterGroupResponse =
            client.post("/mls/groups", &register_body).await?;

        if !response.success {
            // Server rejected our group registration because another group
            // already exists for this conversation. Discard the local group we
            // just built — keeping it would orphan the ratchet state and produce
            // permanent decrypt failures against the canonical group.
            log::warn!(
                "create_group: server reports existing group for conv={} — discarding our local group and signalling AlreadyExists",
                conversation_id
            );
            {
                let mut state = self.inner.lock_or_err()?;
                let inner = state.as_mut().ok_or("MLS not initialized")?;
                inner.conversation_groups.remove(conversation_id);
                inner.groups.remove(&group_id_bytes);
                inner.save_state()?;
            }
            if response.existing_group_id.is_none() {
                // success=false but no existing_group_id is unexpected — propagate as error
                return Err(response
                    .error
                    .unwrap_or_else(|| "register_group failed without details".to_string()));
            }
            return Ok(CreateGroupOutcome::AlreadyExists);
        }

        let commit_body = FanOutCommitBody {
            group_id: group_id_bytes,
            commit_data: commit_bytes,
        };
        let _: serde_json::Value =
            client.post("/mls/commit", &commit_body).await?;

        log::info!("create_group: SUCCESS for conv={}", conversation_id);
        Ok(CreateGroupOutcome::NewGroup(welcome_bytes))
    }

    /// Create a multi-member MLS group. Welcomes are sent to each other member
    /// via the /mls/welcome endpoint (not embedded in a message like DMs).
    pub async fn create_group_multi(
        &self,
        conversation_id: &str,
        member_ids: &[String],
        session_store: &State<'_, SessionStore>,
    ) -> Result<(), String> {
        let client = AuthorizedClient::from_session(session_store)?;
        let my_user_id = auth::get_user_id_from_session(session_store)?;

        let other_ids: Vec<&String> = member_ids.iter()
            .filter(|id| id.as_str() != my_user_id)
            .collect();

        if other_ids.is_empty() {
            return Err("No other members to add".to_string());
        }

        let mut claimed_kps = Vec::new();
        for other_id in &other_ids {
            let claimed: ClaimedKeyPackage = client.get(
                &format!("/mls/key-packages/{}", other_id),
            ).await.map_err(|e| format!("Failed to claim key package for {}: {}", other_id, e))?;
            claimed_kps.push(claimed.key_package_data);
        }

        let (group_id_bytes, welcome_bytes, commit_bytes) = {
            let mut state = self.inner.lock_or_err()?;
            let inner = state.as_mut().ok_or("MLS not initialized")?;

            let mut validated_kps = Vec::new();
            for kp_data in &claimed_kps {
                let kp_in = KeyPackageIn::tls_deserialize(&mut kp_data.as_slice())
                    .map_err(|e| format!("Failed to deserialize key package: {:?}", e))?;
                let validated = kp_in
                    .validate(inner.provider.crypto(), ProtocolVersion::Mls10)
                    .map_err(|e| format!("Failed to validate key package: {:?}", e))?;
                validated_kps.push(validated);
            }

            let group_config = MlsGroupCreateConfig::builder()
                .ciphersuite(CIPHERSUITE)
                .use_ratchet_tree_extension(true)
                .build();

            let group_id = GroupId::from_slice(&uuid::Uuid::new_v4().as_bytes()[..]);

            let mut group = MlsGroup::new_with_group_id(
                &inner.provider, &inner.signer, &group_config,
                group_id, inner.credential_with_key.clone(),
            ).map_err(|e| format!("Failed to create MLS group: {:?}", e))?;

            let (commit, welcome, _) = group
                .add_members(&inner.provider, &inner.signer, &validated_kps)
                .map_err(|e| format!("Failed to add members: {:?}", e))?;

            group.merge_pending_commit(&inner.provider)
                .map_err(|e| format!("Failed to merge commit: {:?}", e))?;

            let gid = group.group_id().as_slice().to_vec();
            let wb = welcome.tls_serialize_detached()
                .map_err(|e| format!("Failed to serialize welcome: {:?}", e))?;
            let cb = commit.tls_serialize_detached()
                .map_err(|e| format!("Failed to serialize commit: {:?}", e))?;

            inner.conversation_groups.insert(conversation_id.to_string(), gid.clone());
            inner.groups.insert(gid.clone(), group);
            inner.save_state()?;

            (gid, wb, cb)
        };

        let register_body = RegisterGroupBody {
            group_id: group_id_bytes.clone(),
            conversation_id: conversation_id.to_string(),
            member_ids: member_ids.to_vec(),
        };
        let response: RegisterGroupResponse =
            client.post("/mls/groups", &register_body).await?;

        if !response.success {
            // Group already exists for this conversation. For group chats this
            // is genuinely unexpected (the conversation row should not have a
            // prior group). Roll back the local state and surface a clear error.
            log::warn!(
                "create_group_multi: server rejected new group registration for conv={} (existing group=hex:{:?})",
                conversation_id,
                response.existing_group_id.as_ref().map(hex::encode),
            );
            {
                let mut state = self.inner.lock_or_err()?;
                let inner = state.as_mut().ok_or("MLS not initialized")?;
                inner.conversation_groups.remove(conversation_id);
                inner.groups.remove(&group_id_bytes);
                inner.save_state()?;
            }
            return Err(format!(
                "Group already exists for this conversation. Please refresh and try again. {}",
                response.error.unwrap_or_default()
            ));
        }

        for other_id in &other_ids {
            let welcome_body = serde_json::json!({
                "recipient_id": other_id,
                "group_id": group_id_bytes,
                "welcome_data": welcome_bytes,
            });
            let _: serde_json::Value =
                client.post("/mls/welcome", &welcome_body).await?;
        }

        let commit_body = FanOutCommitBody {
            group_id: group_id_bytes,
            commit_data: commit_bytes,
        };
        let _: serde_json::Value =
            client.post("/mls/commit", &commit_body).await?;

        Ok(())
    }

    /// Whether we have an MLS group for the given conversation locally.
    pub fn has_group(&self, conversation_id: &str) -> bool {
        let state = match self.inner.lock() {
            Ok(s) => s,
            Err(_) => return false,
        };
        match state.as_ref() {
            Some(inner) => inner.conversation_groups.contains_key(conversation_id),
            None => false,
        }
    }

    /// Encrypt an application message into the group's current epoch.
    /// Advances the sender's ratchet and persists state.
    pub fn encrypt_message(
        &self,
        conversation_id: &str,
        plaintext: &str,
    ) -> Result<Vec<u8>, String> {
        let mut state = self.inner.lock_or_err()?;
        let inner = state.as_mut().ok_or("MLS not initialized")?;

        let group_id = inner.conversation_groups.get(conversation_id)
            .ok_or("No MLS group for this conversation")?.clone();

        let group = inner.groups.get_mut(&group_id)
            .ok_or("MLS group not found in local state")?;

        let ciphertext = group
            .create_message(&inner.provider, &inner.signer, plaintext.as_bytes())
            .map_err(|e| format!("Failed to encrypt message: {:?}", e))?;

        inner.save_state()?;

        ciphertext.tls_serialize_detached()
            .map_err(|e| format!("Failed to serialize ciphertext: {:?}", e))
    }

    /// Decrypt an incoming MLS message. Returns `Ok(Some(plaintext))` for
    /// application messages and `Ok(None)` for non-application content
    /// (commits, proposals, anything else the protocol layer accepts but
    /// surfaces no plaintext for). Callers should skip storage on `None`
    /// rather than treating it as a decrypt failure — the ratchet still
    /// advances and state is persisted.
    pub fn decrypt_message(
        &self,
        conversation_id: &str,
        ciphertext: &[u8],
    ) -> Result<Option<String>, String> {
        let mut state = self.inner.lock_or_err()?;
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

        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(app_msg) => {
                inner.save_state()?;
                let plaintext = String::from_utf8(app_msg.into_bytes())
                    .map_err(|e| format!("Invalid UTF-8 in decrypted message: {}", e))?;
                Ok(Some(plaintext))
            }
            ProcessedMessageContent::StagedCommitMessage(staged_commit) => {
                group.merge_staged_commit(&inner.provider, *staged_commit)
                    .map_err(|e| format!("Failed to merge commit: {:?}", e))?;
                inner.save_state()?;
                Ok(None)
            }
            ProcessedMessageContent::ProposalMessage(_) => {
                inner.save_state()?;
                Ok(None)
            }
            _ => {
                inner.save_state()?;
                Ok(None)
            }
        }
    }

    /// Pull queued Welcome messages from the server, join the groups locally,
    /// and ACK each successful join so the server can release queued messages.
    pub async fn fetch_welcomes(
        &self,
        session_store: &State<'_, SessionStore>,
    ) -> Result<u32, String> {
        let client = AuthorizedClient::from_session(session_store)?;

        let welcomes: Vec<WelcomeMessageResponse> =
            client.get("/mls/welcome").await?;

        if welcomes.is_empty() {
            return Ok(0);
        }

        let mut count = 0u32;
        for welcome_msg in &welcomes {
            match self.process_welcome(&welcome_msg.welcome_data, welcome_msg.conversation_id.as_deref()) {
                Ok(_) => {
                    // Send ACK to server so queued messages can be released
                    let ack_body = serde_json::json!({ "group_id": welcome_msg.group_id });
                    let _ = client.post::<serde_json::Value, _>(
                        "/mls/welcome-ack", &ack_body,
                    ).await;
                    count += 1;
                }
                Err(e) => eprintln!("Failed to process welcome: {}", e),
            }
        }

        Ok(count)
    }

    /// Process a Welcome message and join the corresponding group. Idempotent
    /// when `conversation_id` is provided — if a group already exists locally
    /// for the conversation, the welcome is dropped silently.
    pub fn process_welcome(
        &self,
        welcome_data: &[u8],
        conversation_id: Option<&str>,
    ) -> Result<(), String> {
        let mut state = self.inner.lock_or_err()?;
        let inner = state.as_mut().ok_or("MLS not initialized")?;

        // Skip if we already have a group for this conversation (duplicate welcome)
        if let Some(conv_id) = conversation_id {
            if inner.conversation_groups.contains_key(conv_id) {
                return Ok(());
            }
        }

        let mls_msg_in = MlsMessageIn::tls_deserialize(&mut &welcome_data[..])
            .map_err(|e| format!("Failed to deserialize welcome: {:?}", e))?;

        let welcome = match mls_msg_in.extract() {
            openmls::framing::MlsMessageBodyIn::Welcome(w) => w,
            _ => return Err("Message is not a Welcome".to_string()),
        };

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
        inner.save_state()?;

        Ok(())
    }
}

// ============================================
// TAURI COMMAND SHIMS
// ============================================
//
// Each command is a thin wrapper that delegates to the corresponding method
// on MlsState. Keeps the JS-facing command names and signatures stable while
// the implementation lives on the struct.

#[command]
pub async fn mls_init(
    app_handle: tauri::AppHandle,
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
    local_db: State<'_, LocalDb>,
) -> Result<bool, String> {
    mls_state.init(&app_handle, &session_store, &local_db).await
}

#[command]
pub async fn mls_upload_key_packages(
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<u32, String> {
    mls_state.upload_key_packages(&session_store).await
}

#[command]
pub async fn mls_delete_key_packages(
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<bool, String> {
    mls_state.delete_key_packages(&session_store).await
}

#[command]
pub async fn mls_check_key_packages(
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<i64, String> {
    mls_state.check_key_packages(&session_store).await
}

#[command]
pub async fn mls_create_group(
    conversation_id: String,
    other_user_id: String,
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<Vec<u8>, String> {
    // The frontend `mls_create_group` callers expect the welcome bytes for
    // embedding in the first message. If the server reports the group
    // already exists, we return an empty Vec — the caller should not embed
    // a welcome and should resync via fetch_new_messages.
    match mls_state.create_group(&conversation_id, &other_user_id, &session_store).await? {
        CreateGroupOutcome::NewGroup(wb) => Ok(wb),
        CreateGroupOutcome::AlreadyExists => Ok(Vec::new()),
    }
}

#[command]
pub async fn mls_encrypt_message(
    conversation_id: String,
    plaintext: String,
    mls_state: State<'_, MlsState>,
) -> Result<Vec<u8>, String> {
    mls_state.encrypt_message(&conversation_id, &plaintext)
}

#[command]
pub async fn mls_decrypt_message(
    conversation_id: String,
    ciphertext: Vec<u8>,
    mls_state: State<'_, MlsState>,
) -> Result<Option<String>, String> {
    mls_state.decrypt_message(&conversation_id, &ciphertext)
}

#[command]
pub async fn mls_fetch_welcomes(
    mls_state: State<'_, MlsState>,
    session_store: State<'_, SessionStore>,
) -> Result<u32, String> {
    mls_state.fetch_welcomes(&session_store).await
}

#[command]
pub async fn mls_has_group(
    conversation_id: String,
    mls_state: State<'_, MlsState>,
) -> Result<bool, String> {
    Ok(mls_state.has_group(&conversation_id))
}
