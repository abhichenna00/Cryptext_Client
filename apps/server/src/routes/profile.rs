use crate::{
    auth::Claims,
    config::get_config,
    db::get_pool,
    error::{AppError, AppResult},
};
use aws_sdk_s3::{primitives::ByteStream, Client as S3Client};
use axum::{extract::Json, response::IntoResponse};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{seq::SliceRandom, Rng};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

const ADJECTIVES: &[&str] = &[
    "Swift", "Clever", "Bright", "Bold", "Calm", "Daring", "Eager", "Fancy",
    "Gentle", "Happy", "Jolly", "Keen", "Lively", "Mighty", "Noble", "Peppy",
    "Quick", "Radiant", "Sunny", "Witty", "Zesty", "Cosmic", "Lucky", "Mystic",
    "Pixel", "Quantum", "Retro", "Stellar", "Turbo", "Ultra", "Velvet", "Warp",
    "Amber", "Azure", "Crimson", "Emerald", "Golden", "Indigo", "Jade", "Lunar",
    "Neon", "Onyx", "Pearl", "Ruby", "Silver", "Violet", "Crystal", "Shadow",
];

const NOUNS: &[&str] = &[
    "Panda", "Phoenix", "Dragon", "Wolf", "Falcon", "Tiger", "Bear", "Fox",
    "Hawk", "Lion", "Raven", "Shark", "Viper", "Eagle", "Panther", "Cobra",
    "Comet", "Nova", "Star", "Moon", "Spark", "Storm", "Wave", "Flame",
    "Frost", "Thunder", "Blaze", "Echo", "Drift", "Pulse", "Dash", "Flash",
    "Knight", "Ninja", "Pilot", "Ranger", "Scout", "Wizard", "Hunter", "Voyager",
    "Byte", "Cipher", "Glitch", "Matrix", "Nexus", "Pixel", "Proxy", "Vector",
];

pub const VALID_STATUSES: [&str; 4] = ["online", "idle", "dnd", "offline"];

// ============================================
// TYPES
// ============================================

#[derive(Serialize, Deserialize, Debug, FromRow)]
pub struct ProfileData {
    pub user_id: String,   // added
    pub username: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, FromRow)]
pub struct ProfileNickname {
    pub user_id: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
}

#[derive(Serialize)]
pub struct PlaceholderProfile {
    pub username: String,
    pub nickname: String,
}

#[derive(Deserialize)]
pub struct CreateProfileRequest {
    pub username: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateProfileRequest {
    pub username: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateStatusRequest {
    pub status: String,
}

#[derive(Deserialize)]
pub struct UploadImageRequest {
    pub image_data: String,
    pub file_name: String,
    pub content_type: String,
}

#[derive(Deserialize)]
pub struct GetProfilesByIdsRequest {
    pub user_ids: Vec<String>,
}

// ============================================
// HELPERS
// ============================================

async fn create_s3_client() -> S3Client {
    let config_ref = get_config();
    let sdk_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(config_ref.aws_region.clone()))
        .load()
        .await;
    S3Client::new(&sdk_config)
}

// ============================================
// HANDLERS
// ============================================

pub async fn generate_placeholder_profile() -> AppResult<impl IntoResponse> {
    let mut rng = rand::thread_rng();
    let adjective = ADJECTIVES.choose(&mut rng).unwrap_or(&"Cool");
    let noun = NOUNS.choose(&mut rng).unwrap_or(&"User");
    let number: u16 = rng.gen_range(1000..9999);

    Ok(Json(PlaceholderProfile {
        nickname: format!("{} {}", adjective, noun),
        username: format!("{}_{}{}", adjective.to_lowercase(), noun.to_lowercase(), number),
    }))
}

pub async fn check_profile_exists(claims: Claims) -> AppResult<impl IntoResponse> {
    let pool = get_pool();
    let result: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM profiles WHERE user_id = $1 LIMIT 1"
    )
    .bind(claims.user_id())
    .fetch_optional(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "exists": result.is_some() })))
}

pub async fn get_profile(claims: Claims) -> AppResult<impl IntoResponse> {
    let pool = get_pool();
    let profile: Option<ProfileData> = sqlx::query_as(
        "SELECT user_id, username, nickname, avatar_url, status FROM profiles WHERE user_id = $1"
    )
    .bind(claims.user_id())
    .fetch_optional(pool.as_ref())
    .await?;

    match profile {
        Some(p) => Ok(Json(serde_json::to_value(p).unwrap())),
        None => Err(AppError::NotFound("Profile not found".to_string())),
    }
}

pub async fn create_profile(
    claims: Claims,
    Json(req): Json<CreateProfileRequest>,
) -> AppResult<impl IntoResponse> {
    if req.username.trim().is_empty() || req.nickname.trim().is_empty() {
        return Err(AppError::BadRequest("Username and nickname are required".to_string()));
    }

    let pool = get_pool();

    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT username FROM profiles WHERE username = $1 LIMIT 1"
    )
    .bind(req.username.trim())
    .fetch_optional(pool.as_ref())
    .await?;

    if existing.is_some() {
        return Err(AppError::BadRequest("Username is already taken".to_string()));
    }

    sqlx::query(
        "INSERT INTO profiles (user_id, username, nickname, avatar_url, status) VALUES ($1, $2, $3, $4, 'online')"
    )
    .bind(claims.user_id())
    .bind(req.username.trim())
    .bind(req.nickname.trim())
    .bind(&req.avatar_url)
    .execute(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn update_profile(
    claims: Claims,
    Json(req): Json<UpdateProfileRequest>,
) -> AppResult<impl IntoResponse> {
    if req.username.trim().is_empty() || req.nickname.trim().is_empty() {
        return Err(AppError::BadRequest("Username and nickname are required".to_string()));
    }

    let pool = get_pool();

    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT username FROM profiles WHERE username = $1 AND user_id != $2 LIMIT 1"
    )
    .bind(req.username.trim())
    .bind(claims.user_id())
    .fetch_optional(pool.as_ref())
    .await?;

    if existing.is_some() {
        return Err(AppError::BadRequest("Username is already taken".to_string()));
    }

    sqlx::query(
        "UPDATE profiles SET username = $1, nickname = $2, avatar_url = $3 WHERE user_id = $4"
    )
    .bind(req.username.trim())
    .bind(req.nickname.trim())
    .bind(&req.avatar_url)
    .bind(claims.user_id())
    .execute(pool.as_ref())
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn update_status(
    claims: Claims,
    Json(req): Json<UpdateStatusRequest>,
) -> AppResult<impl IntoResponse> {
    if !VALID_STATUSES.contains(&req.status.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid status. Must be one of: {}",
            VALID_STATUSES.join(", ")
        )));
    }

    let pool = get_pool();
    sqlx::query("UPDATE profiles SET status = $1 WHERE user_id = $2")
        .bind(&req.status)
        .bind(claims.user_id())
        .execute(pool.as_ref())
        .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn upload_profile_image(
    claims: Claims,
    Json(req): Json<UploadImageRequest>,
) -> AppResult<impl IntoResponse> {
    let allowed_types = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if !allowed_types.contains(&req.content_type.as_str()) {
        return Err(AppError::BadRequest(
            "Only PNG, JPEG, WebP, and GIF images are allowed".to_string(),
        ));
    }

    let image_bytes = STANDARD
        .decode(&req.image_data)
        .map_err(|_| AppError::BadRequest("Failed to decode image data".to_string()))?;

    if image_bytes.len() > 5 * 1024 * 1024 {
        return Err(AppError::BadRequest("Image must be less than 5MB".to_string()));
    }

    let config = get_config();
    let s3 = create_s3_client().await;
    let key = format!("avatars/{}/{}", claims.user_id(), req.file_name);

    s3.put_object()
        .bucket(&config.s3_bucket)
        .key(&key)
        .body(ByteStream::from(image_bytes))
        .content_type(&req.content_type)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("S3 upload failed: {}", e)))?;

    let url = format!("{}/{}", config.cloudfront_url, key);
    Ok(Json(serde_json::json!({ "success": true, "url": url })))
}

pub async fn delete_profile_image(claims: Claims) -> AppResult<impl IntoResponse> {
    let config = get_config();
    let s3 = create_s3_client().await;
    let prefix = format!("avatars/{}/", claims.user_id());

    let list = s3
        .list_objects_v2()
        .bucket(&config.s3_bucket)
        .prefix(&prefix)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("S3 list failed: {}", e)))?;

    for obj in list.contents() {
        if let Some(key) = obj.key() {
            let _ = s3
                .delete_object()
                .bucket(&config.s3_bucket)
                .key(key)
                .send()
                .await;
        }
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn get_profiles_by_ids(
    claims: Claims,
    Json(req): Json<GetProfilesByIdsRequest>,
) -> AppResult<impl IntoResponse> {
    let _ = claims;

    if req.user_ids.is_empty() {
        return Ok(Json(serde_json::to_value(Vec::<ProfileNickname>::new()).unwrap()));
    }

    for id in &req.user_ids {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(AppError::BadRequest(format!("Invalid user ID format: {}", id)));
        }
    }

    let pool = get_pool();
    let profiles: Vec<ProfileNickname> = sqlx::query_as(
        "SELECT user_id, nickname, avatar_url, status FROM profiles WHERE user_id = ANY($1)"
    )
    .bind(&req.user_ids)
    .fetch_all(pool.as_ref())
    .await?;

    Ok(Json(serde_json::to_value(profiles).unwrap()))
}