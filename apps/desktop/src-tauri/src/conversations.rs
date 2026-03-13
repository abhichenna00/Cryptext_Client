// src-tauri/src/conversations.rs

use crate::auth::SessionStore;
use crate::http_client;
use crate::mls::MlsState;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationWithDetails {
    pub conversation_id: String,
    pub conversation_type: String,
    pub name: Option<String>,
    pub other_user_id: Option<String>,
    pub other_user_nickname: Option<String>,
    pub other_user_avatar_url: Option<String>,
    pub other_user_status: Option<String>,
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
struct SendMessageBody {
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_bytes: Option<Vec<u8>>,
}

#[derive(Serialize)]
struct EmptyBody {}

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

#[command]
pub async fn get_conversations(
    session_store: State<'_, SessionStore>,
) -> Result<Vec<ConversationWithDetails>, String> {
    let token = get_token(&session_store)?;
    http_client::get("/conversations", &token).await
}

#[command]
pub async fn get_or_create_dm(
    other_user_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<DmResult, String> {
    let token = get_token(&session_store)?;
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
) -> Result<Vec<Message>, String> {
    let token = get_token(&session_store)?;
    let path = format!("/conversations/{}/messages", conversation_id);
    let mut messages: Vec<Message> = http_client::get(&path, &token).await?;

    // Decrypt MLS messages in-place
    for msg in &mut messages {
        if msg.content_type == "mls" {
            if let Some(ref ciphertext) = msg.content_bytes {
                match crate::mls::decrypt_message_inner(&mls_state, &conversation_id, ciphertext) {
                    Ok(plaintext) => {
                        msg.content = plaintext;
                    }
                    Err(_) => {
                        msg.content = "[encrypted message]".to_string();
                    }
                }
            }
        }
    }

    Ok(messages)
}

#[command]
pub async fn send_message(
    conversation_id: String,
    content: String,
    other_user_id: Option<String>,
    session_store: State<'_, SessionStore>,
    mls_state: State<'_, MlsState>,
) -> Result<MessageResult, String> {
    let token = get_token(&session_store)?;
    let path = format!("/conversations/{}/messages", conversation_id);

    // Auto-create MLS group if one doesn't exist and we know the other user
    if !crate::mls::has_group_inner(&mls_state, &conversation_id) {
        if let Some(ref other_id) = other_user_id {
            match crate::mls::create_group_inner(
                &conversation_id,
                other_id,
                &mls_state,
                &session_store,
            ).await {
                Ok(_) => {}
                Err(e) => {
                    eprintln!("MLS group creation failed, sending plaintext: {}", e);
                }
            }
        }
    }

    let body = if crate::mls::has_group_inner(&mls_state, &conversation_id) {
        let ciphertext = crate::mls::encrypt_message_inner(&mls_state, &conversation_id, &content)?;
        SendMessageBody {
            content: "[encrypted]".to_string(),
            content_type: Some("mls".to_string()),
            content_bytes: Some(ciphertext),
        }
    } else {
        SendMessageBody {
            content,
            content_type: None,
            content_bytes: None,
        }
    };

    http_client::post(&path, &token, &body).await
}

#[command]
pub async fn mark_read(
    conversation_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<ReadResult, String> {
    let token = get_token(&session_store)?;
    let path = format!("/conversations/{}/read", conversation_id);
    http_client::post(&path, &token, &EmptyBody {}).await
}