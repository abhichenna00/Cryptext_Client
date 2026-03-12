// src-tauri/src/http_client.rs

use reqwest::Client;
use serde::{de::DeserializeOwned, Serialize};
use crate::config::server_url;

/// Build a reqwest client. Called per-request since Tauri commands are async.
fn client() -> Client {
    Client::new()
}

/// GET request with Bearer token auth.
pub async fn get<T: DeserializeOwned>(path: &str, token: &str) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }

    response.json::<T>().await.map_err(|e| format!("Failed to parse response: {}", e))
}

/// POST request with Bearer token auth and optional JSON body.
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

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }

    response.json::<T>().await.map_err(|e| format!("Failed to parse response: {}", e))
}

/// POST request without auth (used for auth endpoints).
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

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }

    response.json::<T>().await.map_err(|e| format!("Failed to parse response: {}", e))
}

/// PUT request with Bearer token auth and JSON body.
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

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }

    response.json::<T>().await.map_err(|e| format!("Failed to parse response: {}", e))
}

/// DELETE request with Bearer token auth.
pub async fn delete<T: DeserializeOwned>(path: &str, token: &str) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .delete(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }

    response.json::<T>().await.map_err(|e| format!("Failed to parse response: {}", e))
}

/// GET request without auth (used for Google OAuth status polling).
pub async fn get_no_auth<T: DeserializeOwned>(path: &str) -> Result<T, String> {
    let url = format!("{}{}", server_url(), path);
    let response = client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }

    response.json::<T>().await.map_err(|e| format!("Failed to parse response: {}", e))
}
