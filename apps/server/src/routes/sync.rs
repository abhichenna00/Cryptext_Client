use crate::{
    auth::Claims,
    config::get_config,
    error::{AppError, AppResult},
    s3::get_s3,
};
use aws_sdk_s3::primitives::ByteStream;
use axum::{
    body::Bytes,
    extract::Path,
    http::header,
    response::IntoResponse,
};

const MAX_VAULT_SIZE: usize = 4 * 1024;
const MAX_MLS_STATE_SIZE: usize = 10 * 1024 * 1024;
const MAX_MESSAGES_DB_SIZE: usize = 500 * 1024 * 1024;

fn sync_key(user_id: &str, file_name: &str) -> String {
    format!("sync/{}/{}", user_id, file_name)
}

async fn upload_sync_file(
    user_id: &str,
    file_name: &str,
    data: Bytes,
    max_size: usize,
) -> AppResult<()> {
    if data.is_empty() {
        return Err(AppError::BadRequest("Upload body is empty".to_string()));
    }
    if data.len() > max_size {
        return Err(AppError::BadRequest(format!(
            "File too large (max {} bytes)",
            max_size
        )));
    }

    let config = get_config();
    let s3 = get_s3();
    let key = sync_key(user_id, file_name);

    s3.put_object()
        .bucket(&config.s3_bucket)
        .key(&key)
        .body(ByteStream::from(data))
        .content_type("application/octet-stream")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("S3 upload failed: {}", e)))?;

    Ok(())
}

async fn download_sync_file(user_id: &str, file_name: &str) -> AppResult<Bytes> {
    let config = get_config();
    let s3 = get_s3();
    let key = sync_key(user_id, file_name);

    let result = s3
        .get_object()
        .bucket(&config.s3_bucket)
        .key(&key)
        .send()
        .await
        .map_err(|_| AppError::NotFound("Sync data not found".to_string()))?;

    let bytes = result
        .body
        .collect()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read sync data: {}", e)))?
        .into_bytes();

    Ok(bytes.into())
}

async fn delete_sync_file(user_id: &str, file_name: &str) -> AppResult<()> {
    let config = get_config();
    let s3 = get_s3();
    let key = sync_key(user_id, file_name);

    s3.delete_object()
        .bucket(&config.s3_bucket)
        .key(&key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("S3 delete failed: {}", e)))?;

    Ok(())
}

// ============================================
// HANDLERS
// ============================================

pub async fn upload_vault(claims: Claims, body: Bytes) -> AppResult<impl IntoResponse> {
    upload_sync_file(claims.user_id(), "vault", body, MAX_VAULT_SIZE).await?;
    Ok(axum::Json(serde_json::json!({ "success": true })))
}

pub async fn download_vault(claims: Claims) -> AppResult<impl IntoResponse> {
    let bytes = download_sync_file(claims.user_id(), "vault").await?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes))
}

pub async fn upload_mls_state(claims: Claims, body: Bytes) -> AppResult<impl IntoResponse> {
    upload_sync_file(claims.user_id(), "mls_state", body, MAX_MLS_STATE_SIZE).await?;
    Ok(axum::Json(serde_json::json!({ "success": true })))
}

pub async fn download_mls_state(claims: Claims) -> AppResult<impl IntoResponse> {
    let bytes = download_sync_file(claims.user_id(), "mls_state").await?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes))
}

pub async fn upload_messages_db(claims: Claims, body: Bytes) -> AppResult<impl IntoResponse> {
    upload_sync_file(claims.user_id(), "messages.db", body, MAX_MESSAGES_DB_SIZE).await?;
    Ok(axum::Json(serde_json::json!({ "success": true })))
}

pub async fn download_messages_db(claims: Claims) -> AppResult<impl IntoResponse> {
    let bytes = download_sync_file(claims.user_id(), "messages.db").await?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes))
}

pub async fn delete_all_sync_data(claims: Claims) -> AppResult<impl IntoResponse> {
    let user_id = claims.user_id();
    let mut failed: Vec<String> = Vec::new();
    for file in &["vault", "mls_state", "messages.db"] {
        if let Err(e) = delete_sync_file(user_id, file).await {
            tracing::warn!(file = %file, error = %e, "delete_sync_file failed");
            failed.push((*file).to_string());
        }
    }
    Ok(axum::Json(serde_json::json!({
        "success": failed.is_empty(),
        "failed": failed,
    })))
}

pub async fn check_sync_exists(claims: Claims) -> AppResult<impl IntoResponse> {
    let config = get_config();
    let s3 = get_s3();
    let key = sync_key(claims.user_id(), "vault");

    let exists = s3
        .head_object()
        .bucket(&config.s3_bucket)
        .key(&key)
        .send()
        .await
        .is_ok();

    Ok(axum::Json(serde_json::json!({ "exists": exists })))
}
