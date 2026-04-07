use crate::{
    auth::Claims,
    config::get_config,
    db::get_pool,
    error::{AppError, AppResult},
};
use aws_sdk_s3::{primitives::ByteStream, Client as S3Client};
use axum::{
    extract::{Multipart, Query},
    http::header,
    response::IntoResponse,
};
use serde::Deserialize;

// ============================================
// TYPES
// ============================================

#[derive(Deserialize)]
pub struct DownloadQuery {
    pub key: String,
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

/// Validate that the user is a participant in the given conversation.
async fn validate_participant(user_id: &str, conversation_id: &str) -> AppResult<()> {
    if uuid::Uuid::parse_str(conversation_id).is_err() {
        return Err(AppError::BadRequest("Invalid conversation ID".to_string()));
    }

    let pool = get_pool();
    let participant: Option<(String,)> = sqlx::query_as(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = $1::uuid AND user_id = $2",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(pool.as_ref())
    .await?;

    if participant.is_none() {
        return Err(AppError::Unauthorized(
            "You are not a participant in this conversation".to_string(),
        ));
    }

    Ok(())
}

/// Extract the conversation_id from an S3 key like "media/{conversation_id}/{uuid}.enc"
fn extract_conversation_id(key: &str) -> Option<&str> {
    let parts: Vec<&str> = key.split('/').collect();
    if parts.len() == 3 && parts[0] == "media" {
        Some(parts[1])
    } else {
        None
    }
}

// ============================================
// ROUTES
// ============================================

const MAX_UPLOAD_SIZE: usize = 100 * 1024 * 1024; // 100MB

/// Upload an encrypted media blob to S3.
///
/// Expects a multipart form with:
/// - `conversation_id`: UUID of the conversation
/// - `file`: the encrypted binary blob
///
/// Returns `{ s3_key: "media/{conversation_id}/{uuid}.enc" }`
pub async fn upload(claims: Claims, mut multipart: Multipart) -> AppResult<impl IntoResponse> {
    let mut conversation_id: Option<String> = None;
    let mut file_data: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Invalid multipart data: {}", e)))?
    {
        let name = field.name().unwrap_or("").to_string();

        match name.as_str() {
            "conversation_id" => {
                conversation_id = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Invalid conversation_id: {}", e)))?,
                );
            }
            "file" => {
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read file: {}", e)))?;

                if bytes.len() > MAX_UPLOAD_SIZE {
                    return Err(AppError::BadRequest(format!(
                        "File too large (max {}MB)",
                        MAX_UPLOAD_SIZE / 1024 / 1024
                    )));
                }

                file_data = Some(bytes.to_vec());
            }
            _ => {} // Ignore unknown fields
        }
    }

    let conversation_id =
        conversation_id.ok_or_else(|| AppError::BadRequest("Missing conversation_id".to_string()))?;
    let file_data =
        file_data.ok_or_else(|| AppError::BadRequest("Missing file".to_string()))?;

    if file_data.is_empty() {
        return Err(AppError::BadRequest("File is empty".to_string()));
    }

    validate_participant(claims.user_id(), &conversation_id).await?;

    let s3_key = format!("media/{}/{}.enc", conversation_id, uuid::Uuid::new_v4());
    let config = get_config();
    let s3 = create_s3_client().await;

    s3.put_object()
        .bucket(&config.s3_bucket)
        .key(&s3_key)
        .body(ByteStream::from(file_data))
        .content_type("application/octet-stream")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("S3 upload failed: {}", e)))?;

    Ok(axum::Json(
        serde_json::json!({ "success": true, "s3_key": s3_key }),
    ))
}

/// Download an encrypted media blob from S3.
///
/// Query param: `key` — the S3 key (e.g., "media/{conversation_id}/{uuid}.enc")
///
/// Returns the raw encrypted bytes with `application/octet-stream` content type.
pub async fn download(claims: Claims, Query(query): Query<DownloadQuery>) -> AppResult<impl IntoResponse> {
    let conversation_id = extract_conversation_id(&query.key)
        .ok_or_else(|| AppError::BadRequest("Invalid media key format".to_string()))?;

    validate_participant(claims.user_id(), conversation_id).await?;

    let config = get_config();
    let s3 = create_s3_client().await;

    let result = s3
        .get_object()
        .bucket(&config.s3_bucket)
        .key(&query.key)
        .send()
        .await
        .map_err(|e| AppError::NotFound(format!("Media not found: {}", e)))?;

    let bytes = result
        .body
        .collect()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read media from S3: {}", e)))?
        .into_bytes();

    Ok((
        [(header::CONTENT_TYPE, "application/octet-stream")],
        bytes,
    ))
}
