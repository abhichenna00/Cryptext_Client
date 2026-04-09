use std::env;

// Axum server base URL
pub fn server_url() -> String {
    env::var("SERVER_URL").unwrap_or_else(|_| "https://cryptext.duckdns.org".to_string())
}

// WebSocket URL — derived from server URL (connects to Axum /ws endpoint)
pub fn websocket_url() -> Result<String, String> {
    // Allow local override for development
    if let Ok(url) = env::var("WEBSOCKET_URL") {
        return Ok(url);
    }

    let base = server_url();
    let ws_base = base
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    Ok(format!("{}/ws", ws_base))
}