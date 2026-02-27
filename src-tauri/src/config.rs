// src-tauri/src/config.rs

use std::env;

// WebSocket
pub fn websocket_url() -> String {
    env::var("WEBSOCKET_URL").expect("WEBSOCKET_URL must be set")
}

// Axum server base URL
pub fn server_url() -> String {
    env::var("SERVER_URL").unwrap_or_else(|_| "https://cryptext.duckdns.org".to_string())
}