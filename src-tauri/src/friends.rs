// src-tauri/src/friends.rs

use crate::auth::SessionStore;
use crate::http_client;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct FriendWithProfile {
    pub friend_id: String,
    pub username: String,
    pub nickname: String,
    pub created_at: String,
    pub is_online: Option<bool>,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FriendRequest {
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

#[derive(Debug, Serialize, Deserialize)]
pub struct FriendResult {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
struct SendRequestBody {
    to_username: String,
}

#[derive(Serialize)]
struct EmptyBody {}

/// Helper to grab the access token from the session store.
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
pub async fn get_friends(
    session_store: State<'_, SessionStore>,
) -> Result<Vec<FriendWithProfile>, String> {
    let token = get_token(&session_store)?;
    http_client::get("/friends", &token).await
}

#[command]
pub async fn get_incoming_friend_requests(
    session_store: State<'_, SessionStore>,
) -> Result<Vec<FriendRequest>, String> {
    let token = get_token(&session_store)?;
    http_client::get("/friends/requests/incoming", &token).await
}

#[command]
pub async fn get_outgoing_friend_requests(
    session_store: State<'_, SessionStore>,
) -> Result<Vec<FriendRequest>, String> {
    let token = get_token(&session_store)?;
    http_client::get("/friends/requests/outgoing", &token).await
}

#[command]
pub async fn send_friend_request(
    to_username: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let token = get_token(&session_store)?;
    http_client::post("/friends/requests/send", &token, &SendRequestBody { to_username }).await
}

#[command]
pub async fn accept_friend_request(
    request_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let token = get_token(&session_store)?;
    let path = format!("/friends/requests/{}/accept", request_id);
    http_client::post(&path, &token, &EmptyBody {}).await
}

#[command]
pub async fn decline_friend_request(
    request_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let token = get_token(&session_store)?;
    let path = format!("/friends/requests/{}/decline", request_id);
    http_client::post(&path, &token, &EmptyBody {}).await
}

#[command]
pub async fn cancel_friend_request(
    request_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let token = get_token(&session_store)?;
    let path = format!("/friends/requests/{}/cancel", request_id);
    http_client::delete(&path, &token).await
}

#[command]
pub async fn remove_friend(
    friend_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let token = get_token(&session_store)?;
    let path = format!("/friends/{}", friend_id);
    http_client::delete(&path, &token).await
}