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

// ============================================
// TYPES
// ============================================

#[derive(Deserialize)]
pub struct UploadKeyPackagesRequest {
    pub key_packages: Vec<Vec<u8>>,
}

#[derive(Serialize)]
pub struct KeyPackageCountResponse {
    pub count: i64,
}

#[derive(Deserialize)]
pub struct RegisterGroupRequest {
    pub group_id: Vec<u8>,
    pub conversation_id: String,
    pub member_ids: Vec<String>,
}

#[derive(Deserialize)]
pub struct StoreWelcomeRequest {
    pub recipient_id: String,
    pub group_id: Vec<u8>,
    pub welcome_data: Vec<u8>,
}

#[derive(Serialize)]
pub struct WelcomeMessage {
    pub id: String,
    pub group_id: Vec<u8>,
    pub welcome_data: Vec<u8>,
    pub conversation_id: Option<String>,
}

#[derive(Deserialize)]
pub struct FanOutCommitRequest {
    pub group_id: Vec<u8>,
    pub commit_data: Vec<u8>,
}

#[derive(Deserialize)]
pub struct WelcomeAckRequest {
    pub group_id: Vec<u8>,
}

// ============================================
// HANDLERS
// ============================================

/// Upload a batch of key packages for the authenticated user
pub async fn upload_key_packages(
    claims: Claims,
    Json(req): Json<UploadKeyPackagesRequest>,
) -> AppResult<impl IntoResponse> {
    if req.key_packages.is_empty() {
        return Err(AppError::BadRequest("No key packages provided".to_string()));
    }

    if req.key_packages.len() > 100 {
        return Err(AppError::BadRequest("Too many key packages (max 100)".to_string()));
    }

    let pool = get_pool();
    let user_id = claims.user_id();

    for kp in &req.key_packages {
        sqlx::query(
            "INSERT INTO key_packages (user_id, key_package_data) VALUES ($1, $2)"
        )
        .bind(user_id)
        .bind(kp)
        .execute(pool.as_ref())
        .await?;
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "uploaded": req.key_packages.len()
    })))
}

/// Claim one unclaimed key package for a given user (marks it as used)
pub async fn claim_key_package(
    _claims: Claims,
    Path(user_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    let row: Option<(Vec<u8>,)> = sqlx::query_as(
        "UPDATE key_packages SET claimed = TRUE
         WHERE id = (
             SELECT id FROM key_packages
             WHERE user_id = $1 AND claimed = FALSE
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING key_package_data"
    )
    .bind(&user_id)
    .fetch_optional(pool.as_ref())
    .await?;

    match row {
        Some((key_package_data,)) => Ok(Json(serde_json::json!({
            "key_package_data": key_package_data
        }))),
        None => Err(AppError::NotFound(
            "No available key packages for this user".to_string(),
        )),
    }
}

/// Check remaining unclaimed key package count for the authenticated user
pub async fn key_package_count(
    claims: Claims,
) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM key_packages WHERE user_id = $1 AND claimed = FALSE"
    )
    .bind(claims.user_id())
    .fetch_one(pool.as_ref())
    .await?;

    Ok(Json(KeyPackageCountResponse { count }))
}

/// Register an MLS group with its member list
pub async fn register_group(
    claims: Claims,
    Json(req): Json<RegisterGroupRequest>,
) -> AppResult<impl IntoResponse> {
    if uuid::Uuid::parse_str(&req.conversation_id).is_err() {
        return Err(AppError::BadRequest("Invalid conversation ID".to_string()));
    }

    let pool = get_pool();
    let mut tx = pool.begin().await?;

    // Verify the caller is a participant in this conversation
    let participant: Option<(String,)> = sqlx::query_as(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = $1::uuid AND user_id = $2"
    )
    .bind(&req.conversation_id)
    .bind(claims.user_id())
    .fetch_optional(&mut *tx)
    .await?;

    if participant.is_none() {
        return Err(AppError::Unauthorized(
            "You are not a participant in this conversation".to_string(),
        ));
    }

    // Insert the group mapping
    sqlx::query(
        "INSERT INTO mls_groups (group_id, conversation_id) VALUES ($1, $2::uuid)
         ON CONFLICT (group_id) DO NOTHING"
    )
    .bind(&req.group_id)
    .bind(&req.conversation_id)
    .execute(&mut *tx)
    .await?;

    // Insert group members — creator gets confirmed_epoch=1, others get 0
    for member_id in &req.member_ids {
        let epoch = if member_id == claims.user_id() { 1i64 } else { 0i64 };
        sqlx::query(
            "INSERT INTO mls_group_members (group_id, user_id, confirmed_epoch) VALUES ($1, $2, $3)
             ON CONFLICT (group_id, user_id) DO NOTHING"
        )
        .bind(&req.group_id)
        .bind(member_id)
        .bind(epoch)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

/// Store a Welcome message for a recipient
pub async fn store_welcome(
    _claims: Claims,
    Json(req): Json<StoreWelcomeRequest>,
) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    sqlx::query(
        "INSERT INTO mls_welcome_messages (recipient_id, group_id, welcome_data) VALUES ($1, $2, $3)"
    )
    .bind(&req.recipient_id)
    .bind(&req.group_id)
    .bind(&req.welcome_data)
    .execute(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

/// Fetch and consume pending Welcome messages for the authenticated user
pub async fn fetch_welcomes(
    claims: Claims,
) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    let rows: Vec<(String, Vec<u8>, Vec<u8>, Option<String>)> = sqlx::query_as(
        "DELETE FROM mls_welcome_messages w
         USING mls_groups g
         WHERE w.recipient_id = $1 AND g.group_id = w.group_id
         RETURNING w.id::text, w.group_id, w.welcome_data, g.conversation_id::text"
    )
    .bind(claims.user_id())
    .fetch_all(pool.as_ref())
    .await?;

    let welcomes: Vec<WelcomeMessage> = rows
        .into_iter()
        .map(|(id, group_id, welcome_data, conversation_id)| WelcomeMessage {
            id,
            group_id,
            welcome_data,
            conversation_id,
        })
        .collect();

    Ok(Json(welcomes))
}

/// Acknowledge that the user has processed a Welcome and joined the group
pub async fn welcome_ack(
    claims: Claims,
    Json(req): Json<WelcomeAckRequest>,
) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    // Update the member's confirmed epoch
    let rows_affected = sqlx::query(
        "UPDATE mls_group_members SET confirmed_epoch = 1
         WHERE group_id = $1 AND user_id = $2 AND confirmed_epoch = 0"
    )
    .bind(&req.group_id)
    .bind(claims.user_id())
    .execute(pool.as_ref())
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(AppError::NotFound(
            "Not a pending member of this group".to_string(),
        ));
    }

    // Get the conversation_id for this group
    let conv_row: Option<(String,)> = sqlx::query_as(
        "SELECT conversation_id::text FROM mls_groups WHERE group_id = $1"
    )
    .bind(&req.group_id)
    .fetch_optional(pool.as_ref())
    .await?;

    // Flush any pending messages for this user in this conversation
    let mut flushed = 0i64;
    if let Some((conversation_id,)) = conv_row {
        let pending: Vec<(String,)> = sqlx::query_as(
            "DELETE FROM mls_pending_messages
             WHERE recipient_id = $1 AND conversation_id = $2
             RETURNING message_id"
        )
        .bind(claims.user_id())
        .bind(&conversation_id)
        .fetch_all(pool.as_ref())
        .await?;

        flushed = pending.len() as i64;
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "flushed_messages": flushed
    })))
}

/// Fan out a commit message to all group members (excluding sender)
pub async fn fan_out_commit(
    claims: Claims,
    Json(req): Json<FanOutCommitRequest>,
) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    // Verify sender is a member of the group
    let member: Option<(String,)> = sqlx::query_as(
        "SELECT user_id FROM mls_group_members WHERE group_id = $1 AND user_id = $2"
    )
    .bind(&req.group_id)
    .bind(claims.user_id())
    .fetch_optional(pool.as_ref())
    .await?;

    if member.is_none() {
        return Err(AppError::Unauthorized(
            "You are not a member of this group".to_string(),
        ));
    }

    // For now, commits are stored as Welcome messages (they use the same delivery mechanism).
    // The client distinguishes them by context (if you already have the group, it's a commit).
    let other_members: Vec<(String,)> = sqlx::query_as(
        "SELECT user_id FROM mls_group_members WHERE group_id = $1 AND user_id != $2"
    )
    .bind(&req.group_id)
    .bind(claims.user_id())
    .fetch_all(pool.as_ref())
    .await?;

    for (member_id,) in &other_members {
        sqlx::query(
            "INSERT INTO mls_welcome_messages (recipient_id, group_id, welcome_data) VALUES ($1, $2, $3)"
        )
        .bind(member_id)
        .bind(&req.group_id)
        .bind(&req.commit_data)
        .execute(pool.as_ref())
        .await?;
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "delivered_to": other_members.len()
    })))
}
