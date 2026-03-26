// src-tauri/src/profile.rs

use crate::auth::{self, SessionStore};
use crate::http_client;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileData {
    pub user_id: String,
    pub username: Option<String>,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlaceholderProfile {
    pub username: String,
    pub nickname: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileResult {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AvatarResult {
    pub success: bool,
    pub url: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize)]
struct GetProfilesByIdsBody {
    user_ids: Vec<String>,
}

#[derive(Serialize)]
struct CreateProfileBody {
    username: String,
    nickname: String,
    avatar_url: Option<String>,
}

#[derive(Serialize)]
struct UpdateProfileBody {
    username: String,
    nickname: String,
    avatar_url: Option<String>,
}

#[derive(Serialize)]
struct UpdateStatusBody {
    status: String,
}

#[derive(Serialize)]
struct UploadAvatarBody {
    image_data: String,
    file_name: String,
    content_type: String,
}

fn get_token(session_store: &State<'_, SessionStore>) -> Result<String, String> {
    auth::get_token(session_store)
}

#[command]
pub async fn get_profile(
    session_store: State<'_, SessionStore>,
) -> Result<Option<ProfileData>, String> {
    let token = get_token(&session_store)?;
    match http_client::get::<ProfileData>("/profile", &token).await {
        Ok(profile) => Ok(Some(profile)),
        Err(e) if e.contains("HTTP 404") => Ok(None),
        Err(e) => Err(e),
    }
}

#[command]
pub async fn get_profiles_by_ids(
    user_ids: Vec<String>,
    session_store: State<'_, SessionStore>,
) -> Result<Vec<ProfileData>, String> {
    let token = get_token(&session_store)?;
    http_client::post("/profiles", &token, &GetProfilesByIdsBody { user_ids }).await
}

#[command]
pub async fn create_profile(
    username: String,
    nickname: String,
    avatar_url: Option<String>,
    session_store: State<'_, SessionStore>,
) -> Result<ProfileResult, String> {
    let token = get_token(&session_store)?;
    http_client::post("/profile", &token, &CreateProfileBody { username, nickname, avatar_url }).await
}

#[command]
pub async fn update_profile(
    username: String,
    nickname: String,
    avatar_url: Option<String>,
    session_store: State<'_, SessionStore>,
) -> Result<ProfileResult, String> {
    let token = get_token(&session_store)?;
    http_client::put("/profile", &token, &UpdateProfileBody { username, nickname, avatar_url }).await
}

#[command]
pub async fn update_status(
    status: String,
    session_store: State<'_, SessionStore>,
) -> Result<ProfileResult, String> {
    let token = get_token(&session_store)?;
    http_client::put("/profile/status", &token, &UpdateStatusBody { status }).await
}

#[command]
pub async fn upload_avatar(
    image_data: String,
    file_name: String,
    content_type: String,
    session_store: State<'_, SessionStore>,
) -> Result<AvatarResult, String> {
    let token = get_token(&session_store)?;
    http_client::post(
        "/profile/avatar",
        &token,
        &UploadAvatarBody { image_data, file_name, content_type },
    )
    .await
}

#[command]
pub async fn generate_placeholder(
    session_store: State<'_, SessionStore>,
) -> Result<PlaceholderProfile, String> {
    let token = get_token(&session_store)?;
    http_client::get("/profile/placeholder", &token).await
}