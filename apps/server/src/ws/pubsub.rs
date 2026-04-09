use std::sync::Arc;

use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tokio::sync::OnceCell;
use uuid::Uuid;

use super::messages::ServerMessage;
use super::state::ConnectionRegistry;
use crate::redis::get_redis;

const CHANNEL: &str = "ws:messages";

/// Unique ID for this server instance, used to avoid echoing own messages.
static INSTANCE_ID: OnceCell<String> = OnceCell::const_new();

fn instance_id() -> &'static str {
    INSTANCE_ID
        .get()
        .expect("Instance ID not initialized — call init_instance_id() first")
}

/// Call once at startup to set the instance ID.
pub fn init_instance_id() {
    let id = Uuid::new_v4().to_string();
    INSTANCE_ID
        .set(id)
        .expect("Instance ID already initialized");
}

#[derive(Serialize, Deserialize)]
struct PubSubMessage {
    origin: String,
    target: PubSubTarget,
    payload: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PubSubTarget {
    Conversation {
        conversation_id: String,
        exclude_user: String,
    },
    Users {
        user_ids: Vec<String>,
    },
}

/// Publish a message targeting a conversation's members (excluding the sender).
pub async fn publish_to_conversation(
    conversation_id: &str,
    exclude_user: &str,
    msg: &ServerMessage,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let payload = serde_json::to_value(msg)?;
    let pubsub_msg = PubSubMessage {
        origin: instance_id().to_string(),
        target: PubSubTarget::Conversation {
            conversation_id: conversation_id.to_string(),
            exclude_user: exclude_user.to_string(),
        },
        payload,
    };
    let json = serde_json::to_string(&pubsub_msg)?;
    let mut conn = get_redis();
    conn.publish::<_, _, ()>(CHANNEL, json).await?;
    Ok(())
}

/// Publish a message targeting specific users (e.g., friend status updates).
pub async fn publish_to_users(
    user_ids: &[String],
    msg: &ServerMessage,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let payload = serde_json::to_value(msg)?;
    let pubsub_msg = PubSubMessage {
        origin: instance_id().to_string(),
        target: PubSubTarget::Users {
            user_ids: user_ids.to_vec(),
        },
        payload,
    };
    let json = serde_json::to_string(&pubsub_msg)?;
    let mut conn = get_redis();
    conn.publish::<_, _, ()>(CHANNEL, json).await?;
    Ok(())
}

/// Spawn the subscriber task that listens for messages from other instances.
pub async fn spawn_subscriber(registry: Arc<ConnectionRegistry>) -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://redis:6379".to_string());
    let client = redis::Client::open(redis_url)?;
    let mut pubsub_conn = client.get_async_pubsub().await?;
    pubsub_conn.subscribe(CHANNEL).await?;

    tracing::info!("Redis pub/sub subscriber started on channel: {}", CHANNEL);

    tokio::spawn(async move {
        let mut msg_stream = pubsub_conn.on_message();
        while let Some(msg) = futures::StreamExt::next(&mut msg_stream).await {
            let payload: String = match msg.get_payload() {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("Failed to get pub/sub payload: {}", e);
                    continue;
                }
            };

            let pubsub_msg: PubSubMessage = match serde_json::from_str(&payload) {
                Ok(m) => m,
                Err(e) => {
                    tracing::error!("Failed to parse pub/sub message: {}", e);
                    continue;
                }
            };

            // Skip messages from this instance
            if pubsub_msg.origin == instance_id() {
                continue;
            }

            let server_msg: ServerMessage = match serde_json::from_value(pubsub_msg.payload) {
                Ok(m) => m,
                Err(e) => {
                    tracing::error!("Failed to parse pub/sub server message: {}", e);
                    continue;
                }
            };

            match pubsub_msg.target {
                PubSubTarget::Conversation {
                    conversation_id,
                    exclude_user,
                } => {
                    registry
                        .broadcast_to_conversation(&conversation_id, &exclude_user, &server_msg)
                        .await;
                }
                PubSubTarget::Users { user_ids } => {
                    registry.broadcast_to_users(&user_ids, &server_msg);
                }
            }
        }

        tracing::warn!("Redis pub/sub subscriber exited");
    });

    Ok(())
}
