// src-tauri/src/media.rs

use crate::auth::{self, SessionStore};
use crate::http_client::AuthorizedClient;
use crate::local_db::{self, LocalDb, LocalMessage};
use crate::mls::MlsState;
use crate::conversations::{MessageResult, SendMessageBody};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, AeadCore,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager, State};
use uuid::Uuid;

// ============================================
// TYPES
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaMetadata {
    #[serde(rename = "type")]
    pub media_type_tag: String, // always "media"
    pub media_type: String,     // MIME type: "image/jpeg", "video/mp4", etc.
    pub file_name: String,
    pub file_size: u64,
    pub media_key: String,      // base64-encoded AES-256 key
    pub media_nonce: String,    // base64-encoded nonce for full file
    pub s3_key: String,
    pub thumb_nonce: Option<String>, // base64-encoded nonce for thumbnail
    pub thumb_s3_key: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub thumb_width: Option<u32>,
    pub thumb_height: Option<u32>,
    pub blur_hash: Option<String>,
}

// ============================================
// CONSTANTS
// ============================================

const MAX_IMAGE_SIZE: u64 = 25 * 1024 * 1024;  // 25MB
const MAX_VIDEO_SIZE: u64 = 100 * 1024 * 1024;  // 100MB
const THUMBNAIL_MAX_DIM: u32 = 400;

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm"];

// ============================================
// HELPERS
// ============================================

fn get_extension(file_path: &str) -> Result<String, String> {
    std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or_else(|| "File has no extension".to_string())
}

fn get_mime_type(ext: &str) -> Result<String, String> {
    match ext {
        "jpg" | "jpeg" => Ok("image/jpeg".to_string()),
        "png" => Ok("image/png".to_string()),
        "webp" => Ok("image/webp".to_string()),
        "gif" => Ok("image/gif".to_string()),
        "mp4" => Ok("video/mp4".to_string()),
        "webm" => Ok("video/webm".to_string()),
        _ => Err(format!("Unsupported file type: {}", ext)),
    }
}

fn ext_from_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        _ => "bin",
    }
}

fn is_image(ext: &str) -> bool {
    IMAGE_EXTENSIONS.contains(&ext)
}

fn is_video(ext: &str) -> bool {
    VIDEO_EXTENSIONS.contains(&ext)
}

fn encrypt_bytes(key: &aes_gcm::Key<Aes256Gcm>, data: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, data)
        .map_err(|e| format!("Encryption failed: {}", e))?;
    Ok((ciphertext, nonce.to_vec()))
}

fn decrypt_bytes(key_b64: &str, nonce_b64: &str, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    let key_bytes = STANDARD
        .decode(key_b64)
        .map_err(|e| format!("Invalid media key: {}", e))?;
    let nonce_bytes = STANDARD
        .decode(nonce_b64)
        .map_err(|e| format!("Invalid nonce: {}", e))?;

    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))
}

struct ThumbnailOutput {
    jpeg_bytes: Vec<u8>,
    orig_w: u32,
    orig_h: u32,
    thumb_w: u32,
    thumb_h: u32,
    blur_hash: String,
}

/// Downscale arbitrary image bytes (PNG/JPEG/WebP/GIF/raw decoded video frame)
/// into a JPEG thumbnail + blurhash in a single decode pass.
fn generate_thumbnail(image_bytes: &[u8]) -> Result<ThumbnailOutput, String> {
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| format!("Failed to load image: {}", e))?;

    let (orig_w, orig_h) = img.dimensions();
    let thumb = img.thumbnail(THUMBNAIL_MAX_DIM, THUMBNAIL_MAX_DIM);
    let (thumb_w, thumb_h) = thumb.dimensions();

    let rgba = thumb.to_rgba8();
    let (cx, cy) = if thumb_w >= thumb_h { (4, 3) } else { (3, 4) };
    let blur_hash = blurhash::encode(cx, cy, thumb_w, thumb_h, rgba.as_raw())
        .map_err(|e| format!("Failed to encode blurhash: {}", e))?;

    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    Ok(ThumbnailOutput {
        jpeg_bytes: buf.into_inner(),
        orig_w,
        orig_h,
        thumb_w,
        thumb_h,
        blur_hash,
    })
}

fn media_cache_dir(app: &AppHandle, conversation_id: &str) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_data.join("media_cache").join(conversation_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create media cache dir: {}", e))?;
    Ok(dir)
}

// ============================================
// COMMANDS
// ============================================

/// Send an encrypted media file (image or video) in a conversation.
///
/// Accepts the file as raw bytes from the frontend (via drag-and-drop or file picker).
///
/// Flow:
/// 1. Validate file type and size
/// 2. Generate thumbnail (images only)
/// 3. Encrypt file + thumbnail with random AES-256-GCM key
/// 4. Upload encrypted blobs to server → S3
/// 5. Build metadata JSON, encrypt via MLS, send as message
/// 6. Cache original file locally
#[command]
pub async fn send_media(
    app: AppHandle,
    conversation_id: String,
    file_path: String,       // Original file name (for extension and display)
    file_bytes: Vec<u8>,     // Raw file bytes from frontend
    video_thumbnail_bytes: Option<Vec<u8>>, // First-frame JPEG from frontend (videos only)
    other_user_id: Option<String>,
    session_store: State<'_, SessionStore>,
    mls_state: State<'_, MlsState>,
    local_db: State<'_, LocalDb>,
) -> Result<MessageResult, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let current_user_id = auth::get_user_id_from_session(&session_store)?;

    // 1. Validate file type and size
    let ext = get_extension(&file_path)?;
    let mime_type = get_mime_type(&ext)?;
    let file_size = file_bytes.len() as u64;

    if is_image(&ext) && file_size > MAX_IMAGE_SIZE {
        return Err(format!("Image too large (max {}MB)", MAX_IMAGE_SIZE / 1024 / 1024));
    }
    if is_video(&ext) && file_size > MAX_VIDEO_SIZE {
        return Err(format!("Video too large (max {}MB)", MAX_VIDEO_SIZE / 1024 / 1024));
    }
    if !is_image(&ext) && !is_video(&ext) {
        return Err(format!("Unsupported file type: {}", ext));
    }

    // 2. Generate thumbnail + blurhash.
    //    - Images: decode the full file and downscale.
    //    - Videos: use the pre-extracted first frame from the frontend (canvas).
    //      If the frontend couldn't decode the codec, we skip thumbnail and blurhash —
    //      the recipient renders a black placeholder card.
    let thumb_output = if is_image(&ext) {
        Some(generate_thumbnail(&file_bytes)?)
    } else if let Some(ref frame_bytes) = video_thumbnail_bytes {
        // Don't fail the whole send if the frame is somehow unreadable —
        // degrade to no thumbnail rather than blocking the upload.
        generate_thumbnail(frame_bytes).ok()
    } else {
        None
    };

    let (thumbnail_bytes, width, height, thumb_width, thumb_height, blur_hash) = match &thumb_output {
        Some(t) => (
            Some(t.jpeg_bytes.clone()),
            Some(t.orig_w),
            Some(t.orig_h),
            Some(t.thumb_w),
            Some(t.thumb_h),
            Some(t.blur_hash.clone()),
        ),
        None => (None, None, None, None, None, None),
    };

    // 3. Encrypt with random AES-256-GCM key
    let key = Aes256Gcm::generate_key(&mut OsRng);
    let (encrypted_file, file_nonce) = encrypt_bytes(&key, &file_bytes)?;

    let (encrypted_thumb, thumb_nonce) = match &thumbnail_bytes {
        Some(thumb) => {
            let (ct, n) = encrypt_bytes(&key, thumb)?;
            (Some(ct), Some(n))
        }
        None => (None, None),
    };

    // 4. Upload encrypted blobs to server
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let upload_result: serde_json::Value = client.upload_multipart(
        "/media/upload",
        &conversation_id,
        encrypted_file,
        &format!("{}.enc", file_name),
    ).await?;

    let s3_key = upload_result["s3_key"]
        .as_str()
        .ok_or("Server did not return s3_key")?
        .to_string();

    let thumb_s3_key = if let Some(enc_thumb) = encrypted_thumb {
        let thumb_result: serde_json::Value = client.upload_multipart(
            "/media/upload",
            &conversation_id,
            enc_thumb,
            &format!("{}_thumb.enc", file_name),
        ).await?;
        Some(
            thumb_result["s3_key"]
                .as_str()
                .ok_or("Server did not return s3_key for thumbnail")?
                .to_string(),
        )
    } else {
        None
    };

    // 5. Build metadata JSON
    let metadata = MediaMetadata {
        media_type_tag: "media".to_string(),
        media_type: mime_type,
        file_name: file_name.clone(),
        file_size,
        media_key: STANDARD.encode(key.as_slice()),
        media_nonce: STANDARD.encode(&file_nonce),
        s3_key,
        thumb_nonce: thumb_nonce.map(|n| STANDARD.encode(&n)),
        thumb_s3_key,
        width,
        height,
        thumb_width,
        thumb_height,
        blur_hash,
    };

    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

    // 6. Auto-create MLS group if needed (DMs only — groups create MLS eagerly)
    let mut welcome_bytes: Option<Vec<u8>> = None;
    if !mls_state.has_group(&conversation_id) {
        if let Some(ref other_id) = other_user_id {
            match mls_state.create_group(
                &conversation_id,
                other_id,
                &session_store,
            ).await? {
                crate::mls::CreateGroupOutcome::NewGroup(wb) => {
                    welcome_bytes = Some(wb);
                }
                crate::mls::CreateGroupOutcome::AlreadyExists => {
                    // Group already registered server-side. Caller (the
                    // frontend media flow) should refresh the conversation
                    // before retrying so the existing welcome gets processed.
                    return Err(
                        "Encryption needs to sync for this conversation. Please open the chat and try sending again.".to_string(),
                    );
                }
            }
        } else {
            return Err("Encryption not initialized for this conversation. For group chats, try restarting the app to re-process pending welcomes.".to_string());
        }
    }

    // 7. Encrypt metadata via MLS and send as message
    let ciphertext = mls_state.encrypt_message(&conversation_id, &metadata_json)?;
    let body = SendMessageBody {
        client_message_id: Uuid::new_v4().to_string(),
        content: "[encrypted]".to_string(),
        content_type: Some("mls".to_string()),
        content_bytes: Some(ciphertext),
        welcome_data: welcome_bytes,
    };

    let msg_path = format!("/conversations/{}/messages", conversation_id);
    let result: MessageResult = client.post(&msg_path, &body).await?;

    // 8. Store metadata locally and cache the original file
    if result.success {
        if let (Some(ref msg_id), Some(ts)) = (&result.message_id, result.timestamp) {
            let msg = LocalMessage {
                id: msg_id.clone(),
                conversation_id: conversation_id.clone(),
                sender_id: current_user_id,
                content: metadata_json,
                timestamp: ts,
                content_type: "media".to_string(),
            };
            let _ = local_db::store_message(&local_db, &msg);

            // Cache the original file locally
            if let Ok(cache_dir) = media_cache_dir(&app, &conversation_id) {
                let cache_path = cache_dir.join(format!("{}.{}", msg_id, ext));
                let _ = std::fs::write(&cache_path, &file_bytes);
                let _ = insert_cache_entry(&local_db, msg_id, false, &cache_path, file_size);

                // Cache thumbnail too
                if let Some(ref thumb) = thumbnail_bytes {
                    let thumb_path = cache_dir.join(format!("{}_thumb.jpg", msg_id));
                    let _ = std::fs::write(&thumb_path, thumb);
                    let _ = insert_cache_entry(&local_db, msg_id, true, &thumb_path, thumb.len() as u64);
                }
            }
        }
    }

    Ok(result)
}

/// Download and decrypt a media file from S3.
/// Returns the local file path to the decrypted file.
#[command]
pub async fn download_media(
    app: AppHandle,
    s3_key: String,
    media_key: String,
    nonce: String,
    media_type: String,
    conversation_id: String,
    message_id: String,
    is_thumbnail: bool,
    session_store: State<'_, SessionStore>,
    local_db: State<'_, LocalDb>,
) -> Result<String, String> {
    // Check cache first
    if let Ok(Some(path)) = get_cached_path_inner(&local_db, &message_id, is_thumbnail) {
        if std::path::Path::new(&path).exists() {
            return Ok(path);
        }
    }

    let client = AuthorizedClient::from_session(&session_store)?;
    let download_path = format!("/media/download?key={}", urlencoding::encode(&s3_key));
    let encrypted_bytes = client.get_bytes(&download_path).await?;

    let decrypted = decrypt_bytes(&media_key, &nonce, &encrypted_bytes)?;

    // The s3_key carries no original extension (server stores as {uuid}.enc),
    // so derive it from the MLS-authenticated media_type. Tauri's asset
    // protocol sets Content-Type from the extension via mime_guess — wrong
    // extension means <video> tags won't play on WebView2.
    let ext = if is_thumbnail { "jpg" } else { ext_from_mime(&media_type) };

    let cache_dir = media_cache_dir(&app, &conversation_id)?;
    let suffix = if is_thumbnail { "_thumb" } else { "" };
    let cache_path = cache_dir.join(format!("{}{}.{}", message_id, suffix, ext));

    std::fs::write(&cache_path, &decrypted)
        .map_err(|e| format!("Failed to write cached file: {}", e))?;

    let path_str = cache_path.to_string_lossy().to_string();
    let _ = insert_cache_entry(&local_db, &message_id, is_thumbnail, &cache_path, decrypted.len() as u64);

    Ok(path_str)
}

/// Check if a media file is already cached locally.
/// Returns the local file path if cached, None otherwise.
#[command]
pub fn get_cached_media_path(
    local_db: State<'_, LocalDb>,
    message_id: String,
    is_thumbnail: bool,
) -> Result<Option<String>, String> {
    get_cached_path_inner(&local_db, &message_id, is_thumbnail)
}

// ============================================
// CACHE DB HELPERS
// ============================================

fn get_cached_path_inner(
    db: &LocalDb,
    message_id: &str,
    is_thumbnail: bool,
) -> Result<Option<String>, String> {
    let guard = db.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    let mut stmt = conn
        .prepare(
            "SELECT local_path FROM media_cache WHERE message_id = ?1 AND is_thumbnail = ?2",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let path: Option<String> = stmt
        .query_row(rusqlite::params![message_id, is_thumbnail as i32], |row| {
            row.get(0)
        })
        .ok();

    Ok(path)
}

fn insert_cache_entry(
    db: &LocalDb,
    message_id: &str,
    is_thumbnail: bool,
    local_path: &std::path::Path,
    file_size: u64,
) -> Result<(), String> {
    let guard = db.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    conn.execute(
        "INSERT OR REPLACE INTO media_cache (message_id, is_thumbnail, local_path, file_size, cached_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            message_id,
            is_thumbnail as i32,
            local_path.to_string_lossy().to_string(),
            file_size as i64,
            chrono::Utc::now().timestamp(),
        ],
    )
    .map_err(|e| format!("Failed to insert cache entry: {}", e))?;

    Ok(())
}
