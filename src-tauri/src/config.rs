// src-tauri/src/config.rs

use std::env;

// AWS Region
pub fn aws_region() -> String {
    env::var("AWS_REGION").unwrap_or_else(|_| "us-east-2".to_string())
}

// Cognito
pub fn cognito_user_pool_id() -> String {
    env::var("COGNITO_USER_POOL_ID").expect("COGNITO_USER_POOL_ID must be set")
}

pub fn cognito_client_id() -> String {
    env::var("COGNITO_CLIENT_ID").expect("COGNITO_CLIENT_ID must be set")
}

// WebSocket
pub fn websocket_url() -> String {
    env::var("WEBSOCKET_URL").expect("WEBSOCKET_URL must be set")
}