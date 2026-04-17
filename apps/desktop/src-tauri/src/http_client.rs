// src-tauri/src/http_client.rs

use reqwest::{Client, Response};
use serde::{de::DeserializeOwned, Serialize};
use std::sync::OnceLock;
use std::time::Duration;
use crate::config::server_url;

#[derive(Serialize)]
pub struct EmptyBody {}

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

fn client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to build HTTP client")
    })
}

async fn handle_response<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        eprintln!("[HTTP] Error {}: {}", status, text);
        // Return generic message to frontend — don't leak server internals
        let message = match status {
            400 => "Bad request",
            401 => "Not authorized",
            403 => "Forbidden",
            404 => "Not found",
            409 => "Conflict",
            429 => "Too many requests",
            _ => "Server error",
        };
        return Err(format!("HTTP {}: {}", status, message));
    }
    response.json::<T>().await.map_err(|e| {
        eprintln!("[HTTP] Parse error: {}", e);
        "Failed to parse server response".to_string()
    })
}

pub async fn get<T: DeserializeOwned>(path: &str, token: &str) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    handle_response(response).await
}

pub async fn post<T: DeserializeOwned, B: Serialize>(
    path: &str,
    token: &str,
    body: &B,
) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .post(&url)
        .bearer_auth(token)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    handle_response(response).await
}

pub async fn post_no_auth<T: DeserializeOwned, B: Serialize>(
    path: &str,
    body: &B,
) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .post(&url)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    handle_response(response).await
}

pub async fn put<T: DeserializeOwned, B: Serialize>(
    path: &str,
    token: &str,
    body: &B,
) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .put(&url)
        .bearer_auth(token)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    handle_response(response).await
}

pub async fn delete<T: DeserializeOwned>(path: &str, token: &str) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .delete(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    handle_response(response).await
}

pub async fn get_no_auth<T: DeserializeOwned>(path: &str) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    handle_response(response).await
}

/// Upload raw bytes with a PUT request.
pub async fn put_bytes(path: &str, token: &str, body: Vec<u8>) -> Result<(), String> {
    let url = format!("{}{}", server_url(), path);
    let response = Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build upload client: {}", e))?
        .put(&url)
        .bearer_auth(token)
        .header("content-type", "application/octet-stream")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let _ = response.text().await;
        return Err(format!("HTTP {}: Upload failed", status));
    }
    Ok(())
}

/// Download raw bytes with a GET request.
pub async fn get_bytes(path: &str, token: &str) -> Result<Vec<u8>, String> {
    download_binary(path, token).await
}

/// Upload a multipart form with a binary file and a conversation_id field.
/// Uses a longer timeout (5 minutes) for large media uploads.
pub async fn upload_multipart(
    path: &str,
    token: &str,
    conversation_id: &str,
    file_bytes: Vec<u8>,
    file_name: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", server_url(), path);
    let form = reqwest::multipart::Form::new()
        .text("conversation_id", conversation_id.to_string())
        .part(
            "file",
            reqwest::multipart::Part::bytes(file_bytes)
                .file_name(file_name.to_string())
                .mime_str("application/octet-stream")
                .map_err(|e| format!("Failed to set MIME type: {}", e))?,
        );

    let response = Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build upload client: {}", e))?
        .post(&url)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    handle_response(response).await
}

/// Download raw bytes from the server.
/// Uses a longer timeout (5 minutes) for large media downloads.
pub async fn download_binary(path: &str, token: &str) -> Result<Vec<u8>, String> {
    let url = format!("{}{}", server_url(), path);
    let response = Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build download client: {}", e))?
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let _ = response.text().await;
        return Err(format!("HTTP {}: Download failed", status));
    }

    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read response bytes: {}", e))
}
