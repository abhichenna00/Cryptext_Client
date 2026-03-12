use std::env;

// Axum server base URL
pub fn server_url() -> String {
    env::var("SERVER_URL").unwrap_or_else(|_| "https://cryptext.duckdns.org".to_string())
}

// WebSocket URL — fetched from server at runtime
pub async fn websocket_url() -> Result<String, String> {
    // Allow local override for development
    if let Ok(url) = env::var("WEBSOCKET_URL") {
        return Ok(url);
    }

    let url = format!("{}/config/ws", server_url());
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to fetch WS config: {}", e))?;

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse WS config: {}", e))?;

    json["ws_url"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "ws_url not found in server config".to_string())
}