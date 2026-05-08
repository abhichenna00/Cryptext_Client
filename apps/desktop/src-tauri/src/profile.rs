// src-tauri/src/profile.rs

use crate::auth::{AuthProvider, SessionStore};
use crate::http_client::AuthorizedClient;
use crate::sync_utils::MutexExt;
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

#[derive(Serialize)]
pub struct EnterprisePrefill {
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

#[command]
pub async fn get_profile(
    session_store: State<'_, SessionStore>,
) -> Result<Option<ProfileData>, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    match client.get::<ProfileData>("/profile").await {
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
    let client = AuthorizedClient::from_session(&session_store)?;
    client.post("/profiles", &GetProfilesByIdsBody { user_ids }).await
}

#[command]
pub async fn create_profile(
    username: String,
    nickname: String,
    avatar_url: Option<String>,
    session_store: State<'_, SessionStore>,
) -> Result<ProfileResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.post("/profile", &CreateProfileBody { username, nickname, avatar_url }).await
}

#[command]
pub async fn update_profile(
    username: String,
    nickname: String,
    avatar_url: Option<String>,
    session_store: State<'_, SessionStore>,
) -> Result<ProfileResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.put("/profile", &UpdateProfileBody { username, nickname, avatar_url }).await
}

#[command]
pub async fn update_status(
    status: String,
    session_store: State<'_, SessionStore>,
) -> Result<ProfileResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.put("/profile/status", &UpdateStatusBody { status }).await
}

#[command]
pub async fn upload_avatar(
    image_data: String,
    file_name: String,
    content_type: String,
    session_store: State<'_, SessionStore>,
) -> Result<AvatarResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.post(
        "/profile/avatar",
        &UploadAvatarBody { image_data, file_name, content_type },
    )
    .await
}

#[command]
pub async fn generate_placeholder(
    session_store: State<'_, SessionStore>,
) -> Result<PlaceholderProfile, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    client.get("/profile/placeholder").await
}

/// Compute the new-user form prefill for an Entra-federated session. Username
/// is locked on the frontend; nickname remains editable.
#[command]
pub fn get_enterprise_prefill(
    session_store: State<'_, SessionStore>,
) -> Result<EnterprisePrefill, String> {
    let store = session_store.session.lock_or_err()?;
    let session = store.as_ref().ok_or("Not authenticated")?;
    if session.auth_provider != AuthProvider::Entra {
        return Err("Not an enterprise user".to_string());
    }

    let given = session.given_name.as_deref();
    let family = session.family_name.as_deref();
    let email = session.email.as_str();

    let username = derive_enterprise_username(given, family, email);
    let nickname = derive_enterprise_nickname(session.name.as_deref(), given, family, email);

    Ok(EnterprisePrefill { username, nickname })
}

fn derive_enterprise_username(
    given_name: Option<&str>,
    family_name: Option<&str>,
    email: &str,
) -> String {
    let local_part = email.split('@').next().unwrap_or("");
    let domain_first = email
        .split('@')
        .nth(1)
        .and_then(|d| d.split('.').next())
        .unwrap_or("");

    let prefix = match (given_name, family_name) {
        (Some(g), Some(f)) if !g.trim().is_empty() && !f.trim().is_empty() => {
            let initial = g
                .trim()
                .chars()
                .next()
                .map(|c| c.to_lowercase().to_string())
                .unwrap_or_default();
            format!("{}{}", initial, f.trim().to_lowercase())
        }
        _ if !local_part.is_empty() => local_part.to_lowercase(),
        _ => String::new(),
    };

    if !domain_first.is_empty() {
        format!("{}.{}", prefix, domain_first.to_lowercase())
    } else {
        prefix
    }
}

fn derive_enterprise_nickname(
    name: Option<&str>,
    given_name: Option<&str>,
    family_name: Option<&str>,
    email: &str,
) -> String {
    if let Some(n) = name {
        let trimmed = n.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let (Some(g), Some(f)) = (given_name, family_name) {
        if !g.trim().is_empty() && !f.trim().is_empty() {
            return format!("{} {}", g.trim(), f.trim());
        }
    }
    email.split('@').next().unwrap_or("").to_string()
}
