use std::collections::HashSet;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::mpsc;

use super::messages::ServerMessage;
use crate::db::get_pool;

/// Handle to a single WebSocket connection's writer task.
pub struct ConnectionHandle {
    pub sender: mpsc::UnboundedSender<ServerMessage>,
}

/// Tracks all authenticated WebSocket connections and caches conversation members.
pub struct ConnectionRegistry {
    /// user_id → list of connection handles (supports multi-device)
    connections: DashMap<String, Vec<ConnectionHandle>>,
    /// conversation_id → set of participant user_ids (cached from DB)
    conversation_members: DashMap<String, HashSet<String>>,
}

const MAX_CONNECTIONS_PER_USER: usize = 5;

impl ConnectionRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            connections: DashMap::new(),
            conversation_members: DashMap::new(),
        })
    }

    /// Register a new authenticated connection. Returns false if user hit connection limit.
    pub fn register(&self, user_id: &str, sender: mpsc::UnboundedSender<ServerMessage>) -> bool {
        let mut entry = self.connections.entry(user_id.to_string()).or_default();
        if entry.len() >= MAX_CONNECTIONS_PER_USER {
            return false;
        }
        entry.push(ConnectionHandle { sender });
        true
    }

    /// Remove a connection by matching the sender pointer. Returns true if this was the user's last connection.
    pub fn unregister(&self, user_id: &str, sender: &mpsc::UnboundedSender<ServerMessage>) -> bool {
        let mut is_last = false;
        if let Some(mut entry) = self.connections.get_mut(user_id) {
            entry.retain(|h| !h.sender.same_channel(sender));
            is_last = entry.is_empty();
        }
        if is_last {
            self.connections.remove(user_id);
        }
        is_last
    }

    /// Send a message to all connections of a specific user.
    pub fn send_to_user(&self, user_id: &str, msg: &ServerMessage) {
        if let Some(handles) = self.connections.get(user_id) {
            for handle in handles.iter() {
                let _ = handle.sender.send(msg.clone());
            }
        }
    }

    /// Broadcast a message to all participants of a conversation, except the sender.
    pub async fn broadcast_to_conversation(
        &self,
        conversation_id: &str,
        exclude_user: &str,
        msg: &ServerMessage,
    ) {
        let members = self.get_conversation_members(conversation_id).await;
        for member_id in &members {
            if member_id != exclude_user {
                self.send_to_user(member_id, msg);
            }
        }
    }

    /// Broadcast a message to a set of user_ids.
    pub fn broadcast_to_users(&self, user_ids: &[String], msg: &ServerMessage) {
        for user_id in user_ids {
            self.send_to_user(user_id, msg);
        }
    }

    /// Get conversation members, fetching from DB and caching if needed.
    async fn get_conversation_members(&self, conversation_id: &str) -> HashSet<String> {
        // Check cache first
        if let Some(members) = self.conversation_members.get(conversation_id) {
            return members.clone();
        }

        // Fetch from DB
        let pool = get_pool();
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT user_id FROM conversation_participants WHERE conversation_id = $1::uuid",
        )
        .bind(conversation_id)
        .fetch_all(pool.as_ref())
        .await
        .unwrap_or_default();

        let members: HashSet<String> = rows.into_iter().map(|(uid,)| uid).collect();
        self.conversation_members
            .insert(conversation_id.to_string(), members.clone());
        members
    }

    /// Invalidate cached conversation members (call when a conversation is created or members change).
    pub fn invalidate_conversation_cache(&self, conversation_id: &str) {
        self.conversation_members.remove(conversation_id);
    }

    /// Get friend IDs for a user from the DB.
    pub async fn get_friend_ids(&self, user_id: &str) -> Vec<String> {
        let pool = get_pool();
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT friend_id FROM friends WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(pool.as_ref())
        .await
        .unwrap_or_default();

        rows.into_iter().map(|(fid,)| fid).collect()
    }

    /// Check if a user is currently connected.
    pub fn is_online(&self, user_id: &str) -> bool {
        self.connections.contains_key(user_id)
    }
}
