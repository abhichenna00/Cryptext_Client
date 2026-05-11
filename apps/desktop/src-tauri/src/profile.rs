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

    let username = derive_enterprise_username(email, given, family);
    let nickname = derive_enterprise_nickname(session.name.as_deref(), given, family, email);

    Ok(EnterprisePrefill { username, nickname })
}

// Prefer structured given/family name from the Cognito user attributes — they
// are what an IT admin sees in the portal and produce a deterministic,
// human-readable handle. Email-local-part is a fallback for the rare case
// where the IdP omits the name claims.
fn derive_enterprise_username(
    email: &str,
    given_name: Option<&str>,
    family_name: Option<&str>,
) -> String {
    let domain_first = email
        .split('@')
        .nth(1)
        .and_then(|d| d.split('.').next())
        .unwrap_or("")
        .trim()
        .to_lowercase();

    if let (Some(g), Some(f)) = (given_name, family_name) {
        let g = g.trim();
        let f = f.trim();
        if !g.is_empty() && !f.is_empty() {
            let prefix = format!("{}.{}", g.to_lowercase(), f.to_lowercase());
            return if domain_first.is_empty() {
                prefix
            } else {
                format!("{}.{}", prefix, domain_first)
            };
        }
    }

    let local_part = email
        .split('@')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if !local_part.is_empty() {
        return if domain_first.is_empty() {
            local_part
        } else {
            format!("{}.{}", local_part, domain_first)
        };
    }

    "user".to_string()
}

// Prefer structured given/family. The `name` claim is unreliable on some IdPs
// (e.g., this user's Entra config sends the email address as `name`), so reject
// it when it looks like an email.
fn derive_enterprise_nickname(
    name: Option<&str>,
    given_name: Option<&str>,
    family_name: Option<&str>,
    email: &str,
) -> String {
    if let (Some(g), Some(f)) = (given_name, family_name) {
        let g = g.trim();
        let f = f.trim();
        if !g.is_empty() && !f.is_empty() {
            return format!("{} {}", g, f);
        }
    }
    if let Some(n) = name {
        let trimmed = n.trim();
        if !trimmed.is_empty() && !trimmed.contains('@') {
            return trimmed.to_string();
        }
    }
    email.split('@').next().unwrap_or("").to_string()
}
