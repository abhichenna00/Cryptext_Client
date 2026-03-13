use crate::{
    auth::Claims,
    db::get_pool,
    error::{AppError, AppResult},
};
use axum::{
    extract::{Json, Path},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ============================================
// TYPES
// ============================================

#[derive(Serialize, Deserialize, Debug, Clone, FromRow)]
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

#[derive(Serialize, Deserialize, Debug)]
pub struct ConversationWithDetails {
    pub conversation_id: String,
    pub conversation_type: String,
    pub name: Option<String>,
    pub other_user_id: Option<String>,
    pub other_user_nickname: Option<String>,
    pub other_user_avatar_url: Option<String>,  // added
    pub other_user_status: Option<String>,       // added
    pub last_message: Option<String>,
    pub last_message_time: Option<i64>,
    pub last_message_content_type: Option<String>,
    pub has_unread: bool,
}

#[derive(Deserialize)]
pub struct CreateDmRequest {
    pub other_user_id: String,
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub content_type: Option<String>,
    pub content_bytes: Option<Vec<u8>>,
}

// ============================================
// HANDLERS
// ============================================

pub async fn get_conversations(claims: Claims) -> AppResult<impl IntoResponse> {
    let pool = get_pool();
    let user_id = claims.user_id();

    let rows: Vec<(
        String, String, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<i64>, Option<String>, bool,
    )> = sqlx::query_as(
        r#"
        SELECT
            c.id::text as conversation_id,
            c.type as conversation_type,
            c.name,
            (SELECT cp2.user_id FROM conversation_participants cp2
             WHERE cp2.conversation_id = c.id AND cp2.user_id != $1 LIMIT 1) as other_user_id,
            (SELECT p.nickname FROM profiles p
             JOIN conversation_participants cp2 ON p.user_id = cp2.user_id
             WHERE cp2.conversation_id = c.id AND cp2.user_id != $1 LIMIT 1) as other_user_nickname,
            (SELECT p.avatar_url FROM profiles p
             JOIN conversation_participants cp2 ON p.user_id = cp2.user_id
             WHERE cp2.conversation_id = c.id AND cp2.user_id != $1 LIMIT 1) as other_user_avatar_url,
            (SELECT p.status FROM profiles p
             JOIN conversation_participants cp2 ON p.user_id = cp2.user_id
             WHERE cp2.conversation_id = c.id AND cp2.user_id != $1 LIMIT 1) as other_user_status,
            (SELECT m.content FROM messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.timestamp DESC LIMIT 1) as last_message,
            (SELECT m.timestamp FROM messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.timestamp DESC LIMIT 1) as last_message_time,
            (SELECT m.content_type FROM messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.timestamp DESC LIMIT 1) as last_message_content_type,
            COALESCE(
                (SELECT m.timestamp > COALESCE(EXTRACT(EPOCH FROM cp.last_read_at) * 1000, 0)
                 FROM messages m
                 WHERE m.conversation_id = c.id
                 ORDER BY m.timestamp DESC LIMIT 1),
                false
            ) as has_unread
        FROM conversations c
        JOIN conversation_participants cp ON c.id = cp.conversation_id
        WHERE cp.user_id = $1
        ORDER BY
            (SELECT m.timestamp FROM messages m WHERE m.conversation_id = c.id ORDER BY m.timestamp DESC LIMIT 1) DESC NULLS LAST
        "#
    )
    .bind(user_id)
    .fetch_all(pool.as_ref())
    .await?;

    let conversations: Vec<ConversationWithDetails> = rows
        .into_iter()
        .map(|(conversation_id, conversation_type, name, other_user_id, other_user_nickname, other_user_avatar_url, other_user_status, last_message, last_message_time, last_message_content_type, has_unread)| {
            ConversationWithDetails {
                conversation_id, conversation_type, name,
                other_user_id, other_user_nickname,
                other_user_avatar_url, other_user_status,
                last_message, last_message_time, last_message_content_type, has_unread,
            }
        })
        .collect();

    Ok(Json(conversations))
}

pub async fn get_or_create_dm_conversation(
    claims: Claims,
    Json(req): Json<CreateDmRequest>,
) -> AppResult<impl IntoResponse> {
    let user_id = claims.user_id().to_string();

    if uuid::Uuid::parse_str(&req.other_user_id).is_err() {
        return Err(AppError::BadRequest("Invalid user ID".to_string()));
    }

    if req.other_user_id == user_id {
        return Err(AppError::BadRequest(
            "Cannot create conversation with yourself".to_string(),
        ));
    }

    let pool = get_pool();
    let mut tx = pool.begin().await?;

    let dm_key = if user_id < req.other_user_id {
        format!("{}:{}", user_id, req.other_user_id)
    } else {
        format!("{}:{}", req.other_user_id, user_id)
    };

    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM conversations 
         WHERE type = 'direct' AND dm_participant_key = $1
         FOR UPDATE"
    )
    .bind(&dm_key)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((conversation_id,)) = existing {
        tx.commit().await?;
        return Ok(Json(serde_json::json!({ "conversation_id": conversation_id })));
    }

    let insert_result: Result<(String,), _> = sqlx::query_as(
        "INSERT INTO conversations (type, dm_participant_key) VALUES ('direct', $1) 
         ON CONFLICT (dm_participant_key) WHERE type = 'direct' AND dm_participant_key IS NOT NULL
         DO NOTHING
         RETURNING id::text"
    )
    .bind(&dm_key)
    .fetch_one(&mut *tx)
    .await;

    let conversation_id = match insert_result {
        Ok((id,)) => id,
        Err(_) => {
            let existing: (String,) = sqlx::query_as(
                "SELECT id::text FROM conversations WHERE dm_participant_key = $1"
            )
            .bind(&dm_key)
            .fetch_one(&mut *tx)
            .await?;

            tx.commit().await?;
            return Ok(Json(serde_json::json!({ "conversation_id": existing.0 })));
        }
    };

    sqlx::query(
        "INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1::uuid, $2), ($1::uuid, $3)"
    )
    .bind(&conversation_id)
    .bind(&user_id)
    .bind(&req.other_user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(serde_json::json!({ "conversation_id": conversation_id })))
}

pub async fn get_messages(
    claims: Claims,
    Path(conversation_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    if uuid::Uuid::parse_str(&conversation_id).is_err() {
        return Err(AppError::BadRequest("Invalid conversation ID".to_string()));
    }

    let pool = get_pool();

    let participant: Option<(String,)> = sqlx::query_as(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = $1::uuid AND user_id = $2"
    )
    .bind(&conversation_id)
    .bind(claims.user_id())
    .fetch_optional(pool.as_ref())
    .await?;

    if participant.is_none() {
        return Err(AppError::Unauthorized(
            "You are not a participant in this conversation".to_string(),
        ));
    }

    let messages: Vec<Message> = sqlx::query_as(
        "SELECT id::text, conversation_id::text, sender_id, content, timestamp, content_type, content_bytes
         FROM messages
         WHERE conversation_id = $1::uuid
         ORDER BY timestamp ASC"
    )
    .bind(&conversation_id)
    .fetch_all(pool.as_ref())
    .await?;

    Ok(Json(messages))
}

pub async fn send_message(
    claims: Claims,
    Path(conversation_id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> AppResult<impl IntoResponse> {
    if req.content.trim().is_empty() {
        return Err(AppError::BadRequest("Message content cannot be empty".to_string()));
    }

    if req.content.len() > 5000 {
        return Err(AppError::BadRequest(
            "Message content too long (max 5000 characters)".to_string(),
        ));
    }

    if uuid::Uuid::parse_str(&conversation_id).is_err() {
        return Err(AppError::BadRequest("Invalid conversation ID".to_string()));
    }

    let pool = get_pool();

    let participant: Option<(String,)> = sqlx::query_as(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = $1::uuid AND user_id = $2"
    )
    .bind(&conversation_id)
    .bind(claims.user_id())
    .fetch_optional(pool.as_ref())
    .await?;

    if participant.is_none() {
        return Err(AppError::Unauthorized(
            "You are not a participant in this conversation".to_string(),
        ));
    }

    let timestamp = chrono::Utc::now().timestamp_millis();
    let content_type = req.content_type.as_deref().unwrap_or("plaintext");

    sqlx::query(
        "INSERT INTO messages (conversation_id, sender_id, content, timestamp, content_type, content_bytes)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)"
    )
    .bind(&conversation_id)
    .bind(claims.user_id())
    .bind(req.content.trim())
    .bind(timestamp)
    .bind(content_type)
    .bind(&req.content_bytes)
    .execute(pool.as_ref())
    .await?;

    let _ = sqlx::query("UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid")
        .bind(&conversation_id)
        .execute(pool.as_ref())
        .await;

    Ok(Json(serde_json::json!({ "success": true, "error": null })))
}

pub async fn mark_conversation_read(
    claims: Claims,
    Path(conversation_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    if uuid::Uuid::parse_str(&conversation_id).is_err() {
        return Err(AppError::BadRequest("Invalid conversation ID".to_string()));
    }

    let pool = get_pool();

    sqlx::query(
        "UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = $1::uuid AND user_id = $2"
    )
    .bind(&conversation_id)
    .bind(claims.user_id())
    .execute(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}