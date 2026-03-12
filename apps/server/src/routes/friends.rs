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

#[derive(Serialize, Deserialize, Debug)]
pub struct FriendWithProfile {
    pub friend_id: String,
    pub username: String,
    pub nickname: String,
    pub created_at: String,
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
    pub to_username: Option<String>,
    pub to_nickname: Option<String>,
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

    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT f.friend_id, p.username, p.nickname, f.created_at::text
         FROM friends f
         JOIN profiles p ON f.friend_id = p.user_id
         WHERE f.user_id = $1
         ORDER BY p.nickname"
    )
    .bind(claims.user_id())
    .fetch_all(pool.as_ref())
    .await?;

    let friends: Vec<FriendWithProfile> = rows
        .into_iter()
        .map(|(friend_id, username, nickname, created_at)| FriendWithProfile {
            friend_id, username, nickname, created_at,
        })
        .collect();

    Ok(Json(friends))
}

pub async fn remove_friend(
    claims: Claims,
    Path(friend_id): Path<String>,
) -> AppResult<impl IntoResponse> {
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

    let rows: Vec<(String, String, String, String, String, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT fr.id::text, fr.from_user_id, fr.to_user_id, fr.status, fr.created_at::text,
                    p.username, p.nickname
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
        .map(|(id, from_user_id, to_user_id, status, created_at, username, nickname)| {
            FriendRequestWithProfile {
                id, from_user_id, to_user_id, status, created_at,
                from_username: username,
                from_nickname: nickname,
                to_username: None,
                to_nickname: None,
            }
        })
        .collect();

    Ok(Json(results))
}

pub async fn get_outgoing_friend_requests(claims: Claims) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    let rows: Vec<(String, String, String, String, String, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT fr.id::text, fr.from_user_id, fr.to_user_id, fr.status, fr.created_at::text,
                    p.username, p.nickname
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
        .map(|(id, from_user_id, to_user_id, status, created_at, username, nickname)| {
            FriendRequestWithProfile {
                id, from_user_id, to_user_id, status, created_at,
                from_username: None,
                from_nickname: None,
                to_username: username,
                to_nickname: nickname,
            }
        })
        .collect();

    Ok(Json(results))
}

pub async fn accept_friend_request(
    claims: Claims,
    Path(request_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    let pool = get_pool();

    let request: Option<(String, String)> = sqlx::query_as(
        "SELECT from_user_id, to_user_id FROM friend_requests 
         WHERE id = $1::uuid AND to_user_id = $2 AND status = 'pending'"
    )
    .bind(&request_id)
    .bind(claims.user_id())
    .fetch_optional(pool.as_ref())
    .await?;

    let (from_user_id, to_user_id) = match request {
        Some(r) => r,
        None => return Err(AppError::NotFound("Friend request not found".to_string())),
    };

    sqlx::query("UPDATE friend_requests SET status = 'accepted' WHERE id = $1::uuid")
        .bind(&request_id)
        .execute(pool.as_ref())
        .await?;

    sqlx::query("INSERT INTO friends (user_id, friend_id) VALUES ($1, $2), ($2, $1)")
        .bind(&from_user_id)
        .bind(&to_user_id)
        .execute(pool.as_ref())
        .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn decline_friend_request(
    claims: Claims,
    Path(request_id): Path<String>,
) -> AppResult<impl IntoResponse> {
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
