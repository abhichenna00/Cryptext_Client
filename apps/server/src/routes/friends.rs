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

#[derive(Serialize, Deserialize, Debug, sqlx::FromRow)]
pub struct FriendWithProfile {
    pub friend_id: String,
    pub username: String,
    pub nickname: String,
    pub created_at: String,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FriendRequestWithProfile {
    pub id: String,
    pub from_user_id: String,
    pub to_user_id: String,
    pub status: String,
    pub created_at: String,
    pub from_username: Option<String>,
    pub from_nickname: Option<String>,
    pub from_avatar_url: Option<String>,
    pub from_status: Option<String>,
    pub to_username: Option<String>,
    pub to_nickname: Option<String>,
    pub to_avatar_url: Option<String>,
    pub to_status: Option<String>,
}

/// Intermediate row struct for friend request queries
#[derive(sqlx::FromRow)]
struct FriendRequestRow {
    id: String,
    from_user_id: String,
    to_user_id: String,
    status: String,
    created_at: String,
    username: Option<String>,
    nickname: Option<String>,
    avatar_url: Option<String>,
    profile_status: Option<String>,
}

#[derive(Deserialize)]
pub struct SendFriendRequestBody {
    pub to_username: String,
}

// ============================================
// HANDLERS
// ============================================

pub async fn get_friends(claims: Claims) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    let friends: Vec<FriendWithProfile> = sqlx::query_as(
        "SELECT f.friend_id, p.username, p.nickname, f.created_at::text,
                p.avatar_url, p.status
         FROM friends f
         JOIN profiles p ON f.friend_id = p.user_id
         WHERE f.user_id = $1
         ORDER BY p.nickname"
    )
    .bind(claims.user_id())
    .fetch_all(pool.as_ref())
    .await?;

    Ok(Json(friends))
}

pub async fn remove_friend(
    claims: Claims,
    Path(friend_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    if uuid::Uuid::parse_str(&friend_id).is_err() {
        return Err(AppError::BadRequest("Invalid friend ID".to_string()));
    }
    let pool = get_pool();

    sqlx::query(
        "DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)"
    )
    .bind(claims.user_id())
    .bind(&friend_id)
    .execute(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn send_friend_request(
    claims: Claims,
    Json(req): Json<SendFriendRequestBody>,
) -> AppResult<impl IntoResponse> {
    if req.to_username.trim().is_empty() {
        return Err(AppError::BadRequest("Username is required".to_string()));
    }

    let pool = get_pool();
    let from_user_id = claims.user_id();

    let target: Option<(String,)> = sqlx::query_as(
        "SELECT user_id FROM profiles WHERE username = $1"
    )
    .bind(req.to_username.trim())
    .fetch_optional(pool.as_ref())
    .await?;

    let to_user_id = match target {
        Some((id,)) => id,
        None => return Err(AppError::NotFound("User not found".to_string())),
    };

    if to_user_id == from_user_id {
        return Err(AppError::BadRequest(
            "You cannot send a friend request to yourself".to_string(),
        ));
    }

    let existing_friend: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM friends WHERE user_id = $1 AND friend_id = $2"
    )
    .bind(from_user_id)
    .bind(&to_user_id)
    .fetch_optional(pool.as_ref())
    .await?;

    if existing_friend.is_some() {
        return Err(AppError::BadRequest("You are already friends with this user".to_string()));
    }

    let existing_request: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM friend_requests 
         WHERE status = 'pending' 
         AND ((from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1))"
    )
    .bind(from_user_id)
    .bind(&to_user_id)
    .fetch_optional(pool.as_ref())
    .await?;

    if existing_request.is_some() {
        return Err(AppError::BadRequest(
            "A friend request already exists between you and this user".to_string(),
        ));
    }

    sqlx::query(
        "INSERT INTO friend_requests (from_user_id, to_user_id, status) VALUES ($1, $2, 'pending')"
    )
    .bind(from_user_id)
    .bind(&to_user_id)
    .execute(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn get_incoming_friend_requests(claims: Claims) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    let rows: Vec<FriendRequestRow> = sqlx::query_as(
        "SELECT fr.id::text, fr.from_user_id, fr.to_user_id, fr.status, fr.created_at::text,
                p.username, p.nickname, p.avatar_url, p.status AS profile_status
         FROM friend_requests fr
         LEFT JOIN profiles p ON fr.from_user_id = p.user_id
         WHERE fr.to_user_id = $1 AND fr.status = 'pending'
         ORDER BY fr.created_at DESC"
    )
    .bind(claims.user_id())
    .fetch_all(pool.as_ref())
    .await?;

    let results: Vec<FriendRequestWithProfile> = rows
        .into_iter()
        .map(|r| FriendRequestWithProfile {
            id: r.id, from_user_id: r.from_user_id, to_user_id: r.to_user_id,
            status: r.status, created_at: r.created_at,
            from_username: r.username, from_nickname: r.nickname,
            from_avatar_url: r.avatar_url, from_status: r.profile_status,
            to_username: None, to_nickname: None,
            to_avatar_url: None, to_status: None,
        })
        .collect();

    Ok(Json(results))
}

pub async fn get_outgoing_friend_requests(claims: Claims) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    let rows: Vec<FriendRequestRow> = sqlx::query_as(
        "SELECT fr.id::text, fr.from_user_id, fr.to_user_id, fr.status, fr.created_at::text,
                p.username, p.nickname, p.avatar_url, p.status AS profile_status
         FROM friend_requests fr
         LEFT JOIN profiles p ON fr.to_user_id = p.user_id
         WHERE fr.from_user_id = $1 AND fr.status = 'pending'
         ORDER BY fr.created_at DESC"
    )
    .bind(claims.user_id())
    .fetch_all(pool.as_ref())
    .await?;

    let results: Vec<FriendRequestWithProfile> = rows
        .into_iter()
        .map(|r| FriendRequestWithProfile {
            id: r.id, from_user_id: r.from_user_id, to_user_id: r.to_user_id,
            status: r.status, created_at: r.created_at,
            from_username: None, from_nickname: None,
            from_avatar_url: None, from_status: None,
            to_username: r.username, to_nickname: r.nickname,
            to_avatar_url: r.avatar_url, to_status: r.profile_status,
        })
        .collect();

    Ok(Json(results))
}

pub async fn accept_friend_request(
    claims: Claims,
    Path(request_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err(AppError::BadRequest("Invalid request ID".to_string()));
    }
    let pool = get_pool();
    let mut tx = pool.begin().await?;

    let request: Option<(String, String)> = sqlx::query_as(
        "SELECT from_user_id, to_user_id FROM friend_requests
         WHERE id = $1::uuid AND to_user_id = $2 AND status = 'pending'"
    )
    .bind(&request_id)
    .bind(claims.user_id())
    .fetch_optional(&mut *tx)
    .await?;

    let (from_user_id, to_user_id) = match request {
        Some(r) => r,
        None => return Err(AppError::NotFound("Friend request not found".to_string())),
    };

    // Both writes go through the same transaction so a failure on the second
    // step rolls the first back. Otherwise the request could end up marked
    // accepted with no corresponding friend rows.
    sqlx::query("UPDATE friend_requests SET status = 'accepted' WHERE id = $1::uuid")
        .bind(&request_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("INSERT INTO friends (user_id, friend_id) VALUES ($1, $2), ($2, $1)")
        .bind(&from_user_id)
        .bind(&to_user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn decline_friend_request(
    claims: Claims,
    Path(request_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err(AppError::BadRequest("Invalid request ID".to_string()));
    }
    let pool = get_pool();

    sqlx::query(
        "UPDATE friend_requests SET status = 'declined' WHERE id = $1::uuid AND to_user_id = $2"
    )
    .bind(&request_id)
    .bind(claims.user_id())
    .execute(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn cancel_friend_request(
    claims: Claims,
    Path(request_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err(AppError::BadRequest("Invalid request ID".to_string()));
    }
    let pool = get_pool();

    sqlx::query(
        "DELETE FROM friend_requests WHERE id = $1::uuid AND from_user_id = $2"
    )
    .bind(&request_id)
    .bind(claims.user_id())
    .execute(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}
