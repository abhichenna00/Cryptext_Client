use serde::{Deserialize, Serialize};

// ── Shared payload ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagePayload {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub timestamp: i64,
}

// ── Client → Server ──

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ClientMessage {
    Authenticate { token: String },
    NewMessage { message: MessagePayload },
    StatusUpdate { status: String },
    Ping,
}

// ── Server → Client ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ServerMessage {
    Authenticated { user_id: String },
    AuthError { error: String },
    NewMessage { message: MessagePayload },
    StatusUpdate { user_id: String, status: String },
    Pong,
}
