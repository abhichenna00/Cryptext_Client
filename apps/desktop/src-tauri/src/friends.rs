// src-tauri/src/friends.rs

use crate::auth::SessionStore;
use crate::http_client::{self, AuthorizedClient};
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

#[command]
pub async fn get_friends(
    session_store: State<'_, SessionStore>,
) -> Result<Vec<FriendWithProfile>, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.get("/friends").await
}

#[command]
pub async fn get_incoming_friend_requests(
    session_store: State<'_, SessionStore>,
) -> Result<Vec<FriendRequest>, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.get("/friends/requests/incoming").await
}

#[command]
pub async fn get_outgoing_friend_requests(
    session_store: State<'_, SessionStore>,
) -> Result<Vec<FriendRequest>, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.get("/friends/requests/outgoing").await
}

#[command]
pub async fn send_friend_request(
    to_username: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.post("/friends/requests/send", &SendRequestBody { to_username }).await
}

#[command]
pub async fn accept_friend_request(
    request_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let path = format!("/friends/requests/{}/accept", request_id);
    client.post(&path, &http_client::EmptyBody {}).await
}

#[command]
pub async fn decline_friend_request(
    request_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let path = format!("/friends/requests/{}/decline", request_id);
    client.post(&path, &http_client::EmptyBody {}).await
}

#[command]
pub async fn cancel_friend_request(
    request_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let path = format!("/friends/requests/{}/cancel", request_id);
    client.delete(&path).await
}

#[command]
pub async fn remove_friend(
    friend_id: String,
    session_store: State<'_, SessionStore>,
) -> Result<FriendResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let path = format!("/friends/{}", friend_id);
    client.delete(&path).await
}
