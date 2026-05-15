// src-tauri/src/conversations.rs

use crate::auth::{self, SessionStore};
use crate::http_client::{self, AuthorizedClient};
use crate::local_db::{self, LocalDb, LocalMessage};
use crate::mls::MlsState;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

/// Pull the full message history for a conversation and process any
/// embedded Welcome data so the local MLS state catches up. Used when
/// `send_message` discovers that the server already has an MLS group for
/// this conversation and the local client missed the original Welcome.
async fn fetch_and_process_pending_welcomes(
    conversation_id: &str,
    session_store: &State<'_, SessionStore>,
    mls_state: &State<'_, MlsState>,
) -> Result<(), String> {
    let client = AuthorizedClient::from_session(session_store)?;
    let current_user_id = auth::get_user_id_from_session(session_store)?;

    let path = format!("/conversations/{}/messages", conversation_id);
    let server_messages: Vec<Message> = client.get(&path).await?;

    for msg in &server_messages {
        if let Some(ref welcome_data) = msg.welcome_data {
            if msg.sender_id != current_user_id {
                match mls_state.process_welcome(
                    welcome_data,
                    Some(conversation_id),
                ) {
                    Ok(_) => {
                        log::info!(
                            "fetch_and_process_pending_welcomes: joined existing group for conv={} via welcome from sender={}",
                            conversation_id, msg.sender_id
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        log::warn!(
                            "fetch_and_process_pending_welcomes: process_welcome failed for conv={} sender={}: {}",
                            conversation_id, msg.sender_id, e
                        );
                    }
                }
            }
        }
    }
    log::warn!(
        "fetch_and_process_pending_welcomes: no usable welcome found in message history for conv={}",
        conversation_id
    );
    Ok(())
}

/// Classify MLS-decrypted plaintext so it renders through the right UI
/// component. The server only knows the transport content_type ("mls")
/// but the payload itself is either a media metadata JSON blob (sent by
/// media::send_media) or a plain chat message. Mirror the sender's local
/// classification (media.rs stores "media" locally) so both ends agree.
fn classify_decrypted(content: &str) -> String {
    let is_media = serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|v| v.get("type").and_then(|t| t.as_str().map(String::from)))
        == Some("media".to_string());
    if is_media { "media".to_string() } else { "plaintext".to_string() }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationWithDetails {
    pub conversation_id: String,
    pub conversation_type: String,
    pub name: Option<String>,
    pub other_user_id: Option<String>,
    pub other_user_nickname: Option<String>,
    pub other_user_avatar_url: Option<String>,
    pub other_user_status: Option<String>,
    pub member_count: Option<i64>,
    pub last_message: Option<String>,
    pub last_message_time: Option<i64>,
    pub last_message_content_type: Option<String>,
    pub has_unread: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub content: String,
    pub timestamp: i64,
    #[serde(default = "default_content_type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_bytes: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub welcome_data: Option<Vec<u8>>,
}

fn default_content_type() -> String {
    "plaintext".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DmResult {
    pub success: bool,
    pub conversation_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageResult {
    pub success: bool,
    pub error: Option<String>,
    pub message_id: Option<String>,
    pub timestamp: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReadResult {
    pub success: bool,
}

#[derive(Serialize)]
struct CreateDmBody {
    other_user_id: String,
}

#[derive(Serialize)]
pub struct SendMessageBody {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_bytes: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub welcome_data: Option<Vec<u8>>,
}

#[command]
pub async fn get_conversations(
    session_store: State<'_, SessionStore>,
    local_db: State<'_, LocalDb>,
) -> Result<Vec<ConversationWithDetails>, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let mut conversations: Vec<ConversationWithDetails> =
        client.get("/conversations").await?;

    // The server only holds ciphertext, so its `last_message` is a generic
    // `[encrypted]` placeholder. Substitute with the latest decrypted message
    // from the local DB so the sidebar preview is readable.
    let ids: Vec<String> = conversations.iter().map(|c| c.conversation_id.clone()).collect();
    if let Ok(latest) = local_db::get_latest_messages_for_conversations(&local_db, &ids) {
        for conv in &mut conversations {
            if let Some(msg) = latest.get(&conv.conversation_id) {
                conv.last_message = Some(msg.content.clone());
                conv.last_message_time = Some(msg.timestamp);
                conv.last_message_content_type = Some(msg.content_type.clone());
            }
        }
    }

    Ok(conversations)
}

#[command]
pub async fn get_or_create_dm(
    other_user_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<DmResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let body = CreateDmBody { other_user_id };

    match client.post::<serde_json::Value, _>("/conversations/dm", &body).await {
        Ok(json) => {
            let conversation_id = json["conversation_id"].as_str().map(|s| s.to_string());
            Ok(DmResult {
                success: true,
                conversation_id,
                error: None,
            })
        }
        Err(e) => Ok(DmResult {
            success: false,
            conversation_id: None,
            error: Some(e),
        }),
    }
}

#[command]
pub async fn get_messages(
    conversation_id: String,
    session_store: State<'_, SessionStore>,
    mls_state: State<'_, MlsState>,
    local_db: State<'_, LocalDb>,
) -> Result<Vec<Message>, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;
    let path = format!("/conversations/{}/messages", conversation_id);

    // Get IDs of messages we already have locally
    let existing_ids =
        local_db::get_existing_message_ids(&local_db, &conversation_id).unwrap_or_default();

    // Fetch from server
    let server_messages: Vec<Message> = client.get(&path).await?;

    // Process any Welcome data embedded in messages before decrypting
    for msg in &server_messages {
        if let Some(ref welcome_data) = msg.welcome_data {
            if msg.sender_id != current_user_id {
                let _ = mls_state.process_welcome(
                    welcome_data, Some(&conversation_id),
                );
            }
        }
    }

    // Only decrypt new messages we haven't seen before
    let mut new_to_store: Vec<LocalMessage> = Vec::new();
    for msg in &server_messages {
        if existing_ids.contains(&msg.id) {
            continue;
        }

        let (content, content_type) = if msg.content_type == "mls" {
            // Never decrypt our own MLS messages — the ratchet already advanced when we encrypted
            if msg.sender_id == current_user_id {
                continue;
            }
            if let Some(ref ciphertext) = msg.content_bytes {
                match mls_state.decrypt_message(&conversation_id, ciphertext) {
                    Ok(plaintext) => {
                        let ct = classify_decrypted(&plaintext);
                        (plaintext, ct)
                    }
                    Err(e) => {
                        log::error!(
                            "decrypt FAILED for msg_id={} conv={} sender={}: {}",
                            msg.id, conversation_id, msg.sender_id, e
                        );
                        ("[encrypted message]".to_string(), "plaintext".to_string())
                    }
                }
            } else {
                log::warn!(
                    "MLS message msg_id={} conv={} has no content_bytes",
                    msg.id, conversation_id
                );
                ("[encrypted message]".to_string(), "plaintext".to_string())
            }
        } else {
            (msg.content.clone(), msg.content_type.clone())
        };

        new_to_store.push(LocalMessage {
            id: msg.id.clone(),
            conversation_id: msg.conversation_id.clone(),
            sender_id: msg.sender_id.clone(),
            content,
            timestamp: msg.timestamp,
            content_type,
        });
    }

    // Store newly decrypted messages locally
    if !new_to_store.is_empty() {
        let _ = local_db::store_messages(&local_db, &new_to_store);
    }

    // Return all messages from local DB
    let local_messages =
        local_db::get_local_messages_inner(&local_db, &conversation_id, Some(200), None, None)?;

    Ok(local_messages
        .into_iter()
        .map(|m| Message {
            id: m.id,
            conversation_id: m.conversation_id,
            sender_id: m.sender_id,
            content: m.content,
            timestamp: m.timestamp,
            content_type: m.content_type,
            content_bytes: None,
            welcome_data: None,
        })
        .collect())
}

#[command]
pub async fn send_message(
    conversation_id: String,
    content: String,
    other_user_id: Option<String>,
    session_store: State<'_, SessionStore>,
    mls_state: State<'_, MlsState>,
    local_db: State<'_, LocalDb>,
) -> Result<MessageResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;
    let path = format!("/conversations/{}/messages", conversation_id);

    // Auto-create MLS group if one doesn't exist and we know the other user.
    // For group conversations, the MLS group is created eagerly at group-creation
    // time, so this block should only fire for DMs. If it fires for a group
    // (e.g. after MLS state loss), we can't auto-recover yet — the user would
    // need to be re-added to the group.
    let mut welcome_bytes: Option<Vec<u8>> = None;
    if !mls_state.has_group(&conversation_id) {
        if let Some(ref other_id) = other_user_id {
            match mls_state.create_group(
                &conversation_id,
                other_id,
                &session_store,
            ).await? {
                crate::mls::CreateGroupOutcome::NewGroup(wb) => {
                    welcome_bytes = Some(wb);
                }
                crate::mls::CreateGroupOutcome::AlreadyExists => {
                    // Race: another participant registered the canonical MLS
                    // group while we were building ours. Fetch the existing
                    // welcome from the server and join that group instead.
                    log::info!(
                        "send_message: registration race lost for conv={} — fetching existing welcome",
                        conversation_id
                    );
                    fetch_and_process_pending_welcomes(
                        &conversation_id,
                        &session_store,
                        &mls_state,
                    ).await?;
                    if !mls_state.has_group(&conversation_id) {
                        return Err(
                            "Could not join the existing conversation group. Try sending again in a moment.".to_string(),
                        );
                    }
                    // welcome_bytes stays None — we joined the canonical group,
                    // there's no fresh welcome to embed in this message.
                }
            }
        } else {
            return Err("Encryption not initialized for this conversation. For group chats, try restarting the app to re-process pending welcomes.".to_string());
        }
    }

    let plaintext = content.clone();
    let ciphertext = mls_state.encrypt_message(&conversation_id, &content)?;
    let body = SendMessageBody {
        content: "[encrypted]".to_string(),
        content_type: Some("mls".to_string()),
        content_bytes: Some(ciphertext),
        welcome_data: welcome_bytes,
    };

    let result: MessageResult = client.post(&path, &body).await?;

    // Store plaintext locally with the real server ID
    if result.success {
        if let (Some(ref msg_id), Some(ts)) = (&result.message_id, result.timestamp) {
            let msg = LocalMessage {
                id: msg_id.clone(),
                conversation_id: conversation_id.clone(),
                sender_id: current_user_id,
                content: plaintext,
                timestamp: ts,
                content_type: "plaintext".to_string(),
            };
            let _ = local_db::store_message(&local_db, &msg);
        }
    }

    Ok(result)
}

/// Fetch only new messages since the latest local timestamp.
/// Much faster than get_messages for WebSocket notifications.
#[command]
pub async fn fetch_new_messages(
    conversation_id: String,
    session_store: State<'_, SessionStore>,
    mls_state: State<'_, MlsState>,
    local_db: State<'_, LocalDb>,
) -> Result<Vec<Message>, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;

    let latest_ts = local_db::get_latest_timestamp(&local_db, &conversation_id)?;
    let path = match latest_ts {
        Some(ts) => format!("/conversations/{}/messages?after={}", conversation_id, ts),
        None => format!("/conversations/{}/messages", conversation_id),
    };

    let server_messages: Vec<Message> = client.get(&path).await?;

    if server_messages.is_empty() {
        return Ok(Vec::new());
    }

    let existing_ids =
        local_db::get_existing_message_ids(&local_db, &conversation_id).unwrap_or_default();

    // Process Welcome data. Log failures explicitly — a swallowed welcome
    // here is one of the ways a recipient ends up with no MLS group, which
    // then causes the duplicate-group desync if they later try to send.
    for msg in &server_messages {
        if let Some(ref welcome_data) = msg.welcome_data {
            if msg.sender_id != current_user_id {
                match mls_state.process_welcome(
                    welcome_data, Some(&conversation_id),
                ) {
                    Ok(_) => {
                        log::info!(
                            "fetch_new_messages: processed welcome for conv={} from sender={}",
                            conversation_id, msg.sender_id
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "fetch_new_messages: process_welcome FAILED for conv={} sender={}: {}",
                            conversation_id, msg.sender_id, e
                        );
                    }
                }
            }
        }
    }

    // Decrypt and store new messages
    let mut new_messages: Vec<Message> = Vec::new();
    let mut to_store: Vec<LocalMessage> = Vec::new();

    for msg in &server_messages {
        if existing_ids.contains(&msg.id) {
            continue;
        }

        let (content, content_type) = if msg.content_type == "mls" {
            if msg.sender_id == current_user_id {
                continue;
            }
            if let Some(ref ciphertext) = msg.content_bytes {
                match mls_state.decrypt_message(&conversation_id, ciphertext) {
                    Ok(plaintext) => {
                        let ct = classify_decrypted(&plaintext);
                        (plaintext, ct)
                    }
                    Err(e) => {
                        log::error!(
                            "decrypt FAILED for msg_id={} conv={} sender={}: {}",
                            msg.id, conversation_id, msg.sender_id, e
                        );
                        ("[encrypted message]".to_string(), "plaintext".to_string())
                    }
                }
            } else {
                log::warn!(
                    "MLS message msg_id={} conv={} has no content_bytes",
                    msg.id, conversation_id
                );
                ("[encrypted message]".to_string(), "plaintext".to_string())
            }
        } else {
            (msg.content.clone(), msg.content_type.clone())
        };

        let local_msg = LocalMessage {
            id: msg.id.clone(),
            conversation_id: msg.conversation_id.clone(),
            sender_id: msg.sender_id.clone(),
            content: content.clone(),
            timestamp: msg.timestamp,
            content_type: content_type.clone(),
        };

        new_messages.push(Message {
            id: msg.id.clone(),
            conversation_id: msg.conversation_id.clone(),
            sender_id: msg.sender_id.clone(),
            content,
            timestamp: msg.timestamp,
            content_type,
            content_bytes: None,
            welcome_data: None,
        });

        to_store.push(local_msg);
    }

    if !to_store.is_empty() {
        let _ = local_db::store_messages(&local_db, &to_store);
    }

    Ok(new_messages)
}

#[command]
pub async fn mark_read(
    conversation_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<ReadResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let path = format!("/conversations/{}/read", conversation_id);
    client.post(&path, &http_client::EmptyBody {}).await
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupResult {
    pub success: bool,
    pub conversation_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize)]
struct CreateGroupBody {
    name: String,
    member_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupMember {
    pub user_id: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
}

#[command]
pub async fn create_group(
    name: String,
    member_ids: Vec<String>,
    session_store: State<'_, SessionStore>,
    mls_state: State<'_, MlsState>,
) -> Result<GroupResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;

    let mut all_members = member_ids;
    if !all_members.contains(&current_user_id) {
        all_members.push(current_user_id);
    }

    let body = CreateGroupBody {
        name,
        member_ids: all_members.clone(),
    };

    let json: serde_json::Value = match client.post("/conversations/group", &body).await {
        Ok(j) => j,
        Err(e) => return Ok(GroupResult {
            success: false,
            conversation_id: None,
            error: Some(e),
        }),
    };

    let conversation_id = match json["conversation_id"].as_str() {
        Some(id) => id.to_string(),
        None => return Ok(GroupResult {
            success: false,
            conversation_id: None,
            error: Some("No conversation_id returned".to_string()),
        }),
    };

    if let Err(e) = mls_state.create_group_multi(
        &conversation_id, &all_members, &session_store,
    ).await {
        return Ok(GroupResult {
            success: false,
            conversation_id: Some(conversation_id),
            error: Some(format!("Group created but MLS setup failed: {}", e)),
        });
    }

    Ok(GroupResult {
        success: true,
        conversation_id: Some(conversation_id),
        error: None,
    })
}

#[command]
pub async fn get_group_members(
    conversation_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<Vec<GroupMember>, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let path = format!("/conversations/{}/members", conversation_id);
    client.get(&path).await
}
