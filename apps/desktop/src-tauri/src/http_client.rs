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
        return Err(format!("HTTP {}: {}", status, text));
    }
    response.json::<T>().await.map_err(|e| format!("Failed to parse response: {}", e))
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
