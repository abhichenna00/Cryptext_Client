use crate::{
    auth::Claims,
    db::get_pool,
    error::{AppError, AppResult},
};
use axum::{
    extract::{Json, Path, Query},
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub welcome_data: Option<Vec<u8>>,
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
    pub member_count: Option<i64>,
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
pub struct CreateGroupRequest {
    pub name: String,
    pub member_ids: Vec<String>,
}

#[derive(Serialize, Debug, FromRow)]
pub struct GroupMember {
    pub user_id: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub content_type: Option<String>,
    pub content_bytes: Option<Vec<u8>>,
    pub welcome_data: Option<Vec<u8>>,
    pub client_message_id: Option<uuid::Uuid>,
}

// ============================================
// HANDLERS
// ============================================

pub async fn get_conversations(claims: Claims) -> AppResult<impl IntoResponse> {
    let pool = get_pool();
    let user_id = claims.user_id();

    let rows: Vec<(
        String, String, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<i64>,
        Option<String>, Option<i64>, Option<String>, bool,
    )> = sqlx::query_as(
        r#"
        SELECT
            c.id::text as conversation_id,
            c.type as conversation_type,
            c.name,
            CASE WHEN c.type = 'direct' THEN other_cp.user_id END as other_user_id,
            CASE WHEN c.type = 'direct' THEN p.nickname END as other_user_nickname,
            CASE WHEN c.type = 'direct' THEN p.avatar_url END as other_user_avatar_url,
            CASE WHEN c.type = 'direct' THEN p.status END as other_user_status,
            (SELECT COUNT(*) FROM conversation_participants cp2
             WHERE cp2.conversation_id = c.id) as member_count,
            lm.content as last_message,
            lm.timestamp as last_message_time,
            lm.content_type as last_message_content_type,
            COALESCE(lm.timestamp > COALESCE(EXTRACT(EPOCH FROM cp.last_read_at) * 1000, 0), false) as has_unread
        FROM conversations c
        JOIN conversation_participants cp ON c.id = cp.conversation_id AND cp.user_id = $1
        LEFT JOIN LATERAL (
            SELECT ocp.user_id
            FROM conversation_participants ocp
            WHERE ocp.conversation_id = c.id AND ocp.user_id != $1
            LIMIT 1
        ) other_cp ON c.type = 'direct'
        LEFT JOIN profiles p ON p.user_id = other_cp.user_id
        LEFT JOIN LATERAL (
            SELECT m.content, m.timestamp, m.content_type
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.timestamp DESC
            LIMIT 1
        ) lm ON true
        ORDER BY lm.timestamp DESC NULLS LAST
        "#
    )
    .bind(user_id)
    .fetch_all(pool.as_ref())
    .await?;

    let conversations: Vec<ConversationWithDetails> = rows
        .into_iter()
        .map(|(conversation_id, conversation_type, name, other_user_id, other_user_nickname, other_user_avatar_url, other_user_status, member_count, last_message, last_message_time, last_message_content_type, has_unread)| {
            ConversationWithDetails {
                conversation_id, conversation_type, name,
                other_user_id, other_user_nickname,
                other_user_avatar_url, other_user_status,
                member_count,
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

#[derive(Deserialize)]
pub struct MessagesQuery {
    /// Only return messages with timestamp strictly greater than this value.
    pub after: Option<i64>,
}

pub async fn get_messages(
    claims: Claims,
    Path(conversation_id): Path<String>,
    Query(query): Query<MessagesQuery>,
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

    const MAX_MESSAGES: i64 = 500;

    let messages: Vec<Message> = match query.after {
        Some(after_ts) => {
            sqlx::query_as(
                "SELECT id::text, conversation_id::text, sender_id, content, timestamp, content_type, content_bytes, welcome_data
                 FROM messages
                 WHERE conversation_id = $1::uuid AND timestamp > $2
                 ORDER BY timestamp ASC
                 LIMIT $3"
            )
            .bind(&conversation_id)
            .bind(after_ts)
            .bind(MAX_MESSAGES)
            .fetch_all(pool.as_ref())
            .await?
        }
        None => {
            let mut recent: Vec<Message> = sqlx::query_as(
                "SELECT id::text, conversation_id::text, sender_id, content, timestamp, content_type, content_bytes, welcome_data
                 FROM messages
                 WHERE conversation_id = $1::uuid
                 ORDER BY timestamp DESC
                 LIMIT $2"
            )
            .bind(&conversation_id)
            .bind(MAX_MESSAGES)
            .fetch_all(pool.as_ref())
            .await?;
            recent.reverse();
            recent
        }
    };

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

    let insert_result: Result<(String, i64), sqlx::Error> = sqlx::query_as(
        "INSERT INTO messages (conversation_id, sender_id, content, timestamp, content_type, content_bytes, welcome_data, client_message_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id::text, timestamp"
    )
    .bind(&conversation_id)
    .bind(claims.user_id())
    .bind(req.content.trim())
    .bind(timestamp)
    .bind(content_type)
    .bind(&req.content_bytes)
    .bind(&req.welcome_data)
    .bind(req.client_message_id)
    .fetch_one(pool.as_ref())
    .await;

    let (message_id, stored_timestamp, deduped) = match insert_result {
        Ok((id, ts)) => (id, ts, false),
        Err(sqlx::Error::Database(ref db_err))
            if db_err.constraint() == Some("idx_messages_sender_client_id") =>
        {
            let cmid = req.client_message_id.ok_or_else(|| {
                AppError::Internal("dedupe constraint hit with no client_message_id".to_string())
            })?;
            let (id, ts): (String, i64) = sqlx::query_as(
                "SELECT id::text, timestamp FROM messages
                 WHERE sender_id = $1 AND client_message_id = $2"
            )
            .bind(claims.user_id())
            .bind(cmid)
            .fetch_one(pool.as_ref())
            .await?;
            (id, ts, true)
        }
        Err(e) => return Err(AppError::Database(e)),
    };

    if !deduped {
        // For MLS messages, queue delivery for recipients who haven't confirmed their epoch
        if content_type == "mls" {
            let unconfirmed: Vec<(String,)> = sqlx::query_as(
                "SELECT gm.user_id FROM mls_group_members gm
                 JOIN mls_groups g ON g.group_id = gm.group_id
                 WHERE g.conversation_id = $1::uuid
                   AND gm.user_id != $2
                   AND gm.confirmed_epoch < 1"
            )
            .bind(&conversation_id)
            .bind(claims.user_id())
            .fetch_all(pool.as_ref())
            .await?;

            for (recipient_id,) in &unconfirmed {
                sqlx::query(
                    "INSERT INTO mls_pending_messages (group_id, conversation_id, recipient_id, message_id)
                     SELECT g.group_id, $1, $2, $3
                     FROM mls_groups g WHERE g.conversation_id = $1::uuid
                     LIMIT 1"
                )
                .bind(&conversation_id)
                .bind(recipient_id)
                .bind(&message_id)
                .execute(pool.as_ref())
                .await?;
            }
        }

        let _ = sqlx::query("UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid")
            .bind(&conversation_id)
            .execute(pool.as_ref())
            .await;
    }

    Ok(Json(serde_json::json!({ "success": true, "error": null, "message_id": message_id, "timestamp": stored_timestamp, "queued": content_type == "mls" })))
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

pub async fn create_group_conversation(
    claims: Claims,
    Json(req): Json<CreateGroupRequest>,
) -> AppResult<impl IntoResponse> {
    let creator_id = claims.user_id().to_string();

    let name = req.name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest(
            "Group name must be 1-100 characters".to_string(),
        ));
    }

    if req.member_ids.len() < 2 || req.member_ids.len() > 256 {
        return Err(AppError::BadRequest(
            "Groups must have 2-256 members".to_string(),
        ));
    }

    if !req.member_ids.contains(&creator_id) {
        return Err(AppError::BadRequest(
            "Creator must be included in member list".to_string(),
        ));
    }

    for id in &req.member_ids {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(AppError::BadRequest(format!("Invalid member ID: {}", id)));
        }
    }

    let pool = get_pool();

    let existing_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM profiles WHERE user_id = ANY($1)"
    )
    .bind(&req.member_ids)
    .fetch_one(pool.as_ref())
    .await?;

    if existing_count.0 != req.member_ids.len() as i64 {
        return Err(AppError::BadRequest(
            "One or more members do not have a profile".to_string(),
        ));
    }

    let mut tx = pool.begin().await?;

    let (conversation_id,): (String,) = sqlx::query_as(
        "INSERT INTO conversations (type, name) VALUES ('group', $1) RETURNING id::text"
    )
    .bind(name)
    .fetch_one(&mut *tx)
    .await?;

    for member_id in &req.member_ids {
        sqlx::query(
            "INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1::uuid, $2)"
        )
        .bind(&conversation_id)
        .bind(member_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(Json(serde_json::json!({ "conversation_id": conversation_id })))
}

pub async fn get_group_members(
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

    let members: Vec<GroupMember> = sqlx::query_as(
        "SELECT p.user_id, p.nickname, p.avatar_url, p.status
         FROM conversation_participants cp
         JOIN profiles p ON p.user_id = cp.user_id
         WHERE cp.conversation_id = $1::uuid
         ORDER BY p.nickname"
    )
    .bind(&conversation_id)
    .fetch_all(pool.as_ref())
    .await?;

    Ok(Json(members))
}
