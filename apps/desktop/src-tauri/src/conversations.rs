// src-tauri/src/conversations.rs

use crate::auth::{self, SessionStore};
use crate::http_client;
use crate::local_db::{self, LocalDb, LocalMessage};
use crate::mls::MlsState;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

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
) -> Result<Vec<ConversationWithDetails>, String> {
    let token = auth::get_token(&session_store)?;
    http_client::get("/conversations", &token).await
}

#[command]
pub async fn get_or_create_dm(
    other_user_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<DmResult, String> {
    let token = auth::get_token(&session_store)?;
    let body = CreateDmBody { other_user_id };

    match http_client::post::<serde_json::Value, _>("/conversations/dm", &token, &body).await {
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
    let token = auth::get_token(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;
    let path = format!("/conversations/{}/messages", conversation_id);

    // Get IDs of messages we already have locally
    let existing_ids =
        local_db::get_existing_message_ids(&local_db, &conversation_id).unwrap_or_default();

    // Fetch from server
    let server_messages: Vec<Message> = http_client::get(&path, &token).await?;

    // Process any Welcome data embedded in messages before decrypting
    for msg in &server_messages {
        if let Some(ref welcome_data) = msg.welcome_data {
            if msg.sender_id != current_user_id {
                let _ = crate::mls::process_welcome(
                    &mls_state, welcome_data, Some(&conversation_id),
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
                match crate::mls::decrypt_message_inner(&mls_state, &conversation_id, ciphertext) {
                    Ok(plaintext) => {
                        let ct = classify_decrypted(&plaintext);
                        (plaintext, ct)
                    }
                    Err(_) => ("[encrypted message]".to_string(), "plaintext".to_string()),
                }
            } else {
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
    let token = auth::get_token(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;
    let path = format!("/conversations/{}/messages", conversation_id);

    // Auto-create MLS group if one doesn't exist and we know the other user.
    // For group conversations, the MLS group is created eagerly at group-creation
    // time, so this block should only fire for DMs. If it fires for a group
    // (e.g. after MLS state loss), we can't auto-recover yet — the user would
    // need to be re-added to the group.
    let mut welcome_bytes: Option<Vec<u8>> = None;
    if !crate::mls::has_group_inner(&mls_state, &conversation_id) {
        if let Some(ref other_id) = other_user_id {
            let wb = crate::mls::create_group_inner(
                &conversation_id,
                other_id,
                &mls_state,
                &session_store,
            ).await?;
            welcome_bytes = Some(wb);
        } else {
            return Err("Encryption not initialized for this conversation. For group chats, try restarting the app to re-process pending welcomes.".to_string());
        }
    }

    let plaintext = content.clone();
    let ciphertext = crate::mls::encrypt_message_inner(&mls_state, &conversation_id, &content)?;
    let body = SendMessageBody {
        content: "[encrypted]".to_string(),
        content_type: Some("mls".to_string()),
        content_bytes: Some(ciphertext),
        welcome_data: welcome_bytes,
    };

    let result: MessageResult = http_client::post(&path, &token, &body).await?;

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
    let token = auth::get_token(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;

    let latest_ts = local_db::get_latest_timestamp(&local_db, &conversation_id)?;
    let path = match latest_ts {
        Some(ts) => format!("/conversations/{}/messages?after={}", conversation_id, ts),
        None => format!("/conversations/{}/messages", conversation_id),
    };

    let server_messages: Vec<Message> = http_client::get(&path, &token).await?;

    if server_messages.is_empty() {
        return Ok(Vec::new());
    }

    let existing_ids =
        local_db::get_existing_message_ids(&local_db, &conversation_id).unwrap_or_default();

    // Process Welcome data
    for msg in &server_messages {
        if let Some(ref welcome_data) = msg.welcome_data {
            if msg.sender_id != current_user_id {
                let _ = crate::mls::process_welcome(
                    &mls_state, welcome_data, Some(&conversation_id),
                );
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
                match crate::mls::decrypt_message_inner(&mls_state, &conversation_id, ciphertext) {
                    Ok(plaintext) => {
                        let ct = classify_decrypted(&plaintext);
                        (plaintext, ct)
                    }
                    Err(_) => ("[encrypted message]".to_string(), "plaintext".to_string()),
                }
            } else {
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
    let token = auth::get_token(&session_store)?;
    let path = format!("/conversations/{}/read", conversation_id);
    http_client::post(&path, &token, &http_client::EmptyBody {}).await
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
    let token = auth::get_token(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;

    let mut all_members = member_ids;
    if !all_members.contains(&current_user_id) {
        all_members.push(current_user_id);
    }

    let body = CreateGroupBody {
        name,
        member_ids: all_members.clone(),
    };

    let json: serde_json::Value = match http_client::post("/conversations/group", &token, &body).await {
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

    if let Err(e) = crate::mls::create_group_multi_inner(
        &conversation_id, &all_members, &mls_state, &session_store,
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
    let token = auth::get_token(&session_store)?;
    let path = format!("/conversations/{}/members", conversation_id);
    http_client::get(&path, &token).await
}