use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, WebSocketUpgrade,
    },
    response::IntoResponse,
    Extension,
};
use futures::{SinkExt, StreamExt};
use std::collections::HashSet;
use std::net::SocketAddr;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::messages::{ClientMessage, ServerMessage};
use super::pubsub;
use super::state::ConnectionRegistry;
use crate::routes::cognito::redeem_ws_ticket;

const AUTH_TIMEOUT_SECS: u64 = 10;
const MAX_MESSAGE_SIZE: usize = 256 * 1024; // 256 KB

/// HTTP → WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Extension(registry): Extension<Arc<ConnectionRegistry>>,
) -> impl IntoResponse {
    ws.max_message_size(MAX_MESSAGE_SIZE)
        .on_upgrade(move |socket| handle_connection(socket, addr, registry))
}

/// Full lifecycle for a single WebSocket connection.
async fn handle_connection(
    socket: WebSocket,
    addr: SocketAddr,
    registry: Arc<ConnectionRegistry>,
) {
    let (mut sink, mut stream) = socket.split();

    // Create channel for the writer task
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();

    // Spawn writer task: reads from channel, sends to WebSocket sink
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(e) => {
                    tracing::error!("Failed to serialize WS message: {}", e);
                    continue;
                }
            };
            if sink.send(Message::Text(json)).await.is_err() {
                break; // Connection closed
            }
        }
    });

    // ── Phase 1: Authentication ──
    let user_id = match authenticate(&mut stream, &tx).await {
        Some(uid) => uid,
        None => {
            tracing::debug!("WS auth failed for {}", addr);
            write_task.abort();
            return;
        }
    };

    // Register in connection registry
    if !registry.register(&user_id, tx.clone()) {
        let _ = tx.send(ServerMessage::AuthError {
            error: "Too many connections".to_string(),
        });
        write_task.abort();
        return;
    }

    tracing::info!("WS authenticated: user={} addr={}", user_id, addr);

    // Broadcast online status to friends
    let friend_ids = registry.get_friend_ids(&user_id).await;
    let online_msg = ServerMessage::StatusUpdate {
        user_id: user_id.clone(),
        status: "online".to_string(),
    };
    registry.broadcast_to_users(&friend_ids, &online_msg);
    let _ = pubsub::publish_to_users(&friend_ids, &online_msg).await;

    // ── Phase 2: Message loop ──
    // Tolerate a small number of malformed frames (transient client bug, racy
    // disconnect, etc.) but close the connection if the count exceeds the
    // threshold so a misbehaving client can't tie up the loop indefinitely.
    const MAX_MALFORMED_FRAMES: u32 = 16;
    let mut malformed_count: u32 = 0;
    while let Some(Ok(frame)) = stream.next().await {
        match frame {
            Message::Text(text) => {
                let client_msg: ClientMessage = match serde_json::from_str(&text) {
                    Ok(m) => m,
                    Err(e) => {
                        malformed_count += 1;
                        tracing::debug!(
                            "WS malformed frame from user={} (count={}): {}",
                            user_id, malformed_count, e
                        );
                        if malformed_count >= MAX_MALFORMED_FRAMES {
                            tracing::warn!(
                                "WS closing connection: user={} exceeded malformed-frame threshold ({})",
                                user_id, MAX_MALFORMED_FRAMES
                            );
                            break;
                        }
                        continue;
                    }
                };
                handle_client_message(&user_id, client_msg, &registry, &tx).await;
            }
            Message::Close(_) => break,
            _ => {} // Ignore binary, ping/pong frames (axum handles pong automatically)
        }
    }

    // ── Phase 3: Disconnect ──
    let was_last = registry.unregister(&user_id, &tx);
    write_task.abort();

    tracing::info!("WS disconnected: user={} addr={}", user_id, addr);

    // Broadcast offline status if this was the user's last connection
    if was_last {
        let offline_msg = ServerMessage::StatusUpdate {
            user_id: user_id.clone(),
            status: "offline".to_string(),
        };
        registry.broadcast_to_users(&friend_ids, &offline_msg);
        let _ = pubsub::publish_to_users(&friend_ids, &offline_msg).await;
    }
}

/// Wait for the authenticate message within the timeout window.
/// Returns the user_id on success, None on failure.
async fn authenticate(
    stream: &mut futures::stream::SplitStream<WebSocket>,
    tx: &mpsc::UnboundedSender<ServerMessage>,
) -> Option<String> {
    let auth_result = tokio::time::timeout(
        std::time::Duration::from_secs(AUTH_TIMEOUT_SECS),
        wait_for_auth_message(stream),
    )
    .await;

    match auth_result {
        Ok(Some(ticket)) => {
            // The handshake message carries a short-lived ticket from
            // `/auth/ws-ticket`, not a bearer. Redeeming the ticket is
            // single-use and binds the connection to a user_id without
            // ever putting the bearer through the JS layer.
            match redeem_ws_ticket(&ticket).await {
                Some(user_id) => {
                    let _ = tx.send(ServerMessage::Authenticated {
                        user_id: user_id.clone(),
                    });
                    Some(user_id)
                }
                None => {
                    let _ = tx.send(ServerMessage::AuthError {
                        error: "Invalid or expired ticket".to_string(),
                    });
                    None
                }
            }
        }
        Ok(None) => {
            // Stream closed before auth
            None
        }
        Err(_) => {
            // Timeout
            let _ = tx.send(ServerMessage::AuthError {
                error: "Authentication timeout".to_string(),
            });
            None
        }
    }
}

/// Read frames until we get an Authenticate message.
async fn wait_for_auth_message(
    stream: &mut futures::stream::SplitStream<WebSocket>,
) -> Option<String> {
    while let Some(Ok(frame)) = stream.next().await {
        if let Message::Text(text) = frame {
            if let Ok(ClientMessage::Authenticate { token }) = serde_json::from_str(&text) {
                return Some(token);
            }
            // Non-authenticate message before auth — ignore
        }
    }
    None
}

/// Route a client message to the appropriate handler.
async fn handle_client_message(
    user_id: &str,
    msg: ClientMessage,
    registry: &Arc<ConnectionRegistry>,
    tx: &mpsc::UnboundedSender<ServerMessage>,
) {
    match msg {
        ClientMessage::NewMessage { message } => {
            // Verify sender_id matches authenticated user
            if message.sender_id != user_id {
                return;
            }

            // The sender must actually be a participant of the conversation
            // they're broadcasting into. Without this check, any
            // authenticated client could push fake notifications into any
            // conversation whose id they could guess, forcing recipients
            // through fetch + decrypt work for nothing.
            if !registry
                .is_conversation_member(&message.conversation_id, user_id)
                .await
            {
                return;
            }

            let server_msg = ServerMessage::NewMessage {
                message: message.clone(),
            };

            // Broadcast to conversation members (excluding sender)
            registry
                .broadcast_to_conversation(&message.conversation_id, user_id, &server_msg)
                .await;

            // Publish to Redis for other server instances
            let _ = pubsub::publish_to_conversation(
                &message.conversation_id,
                user_id,
                &server_msg,
            )
            .await;
        }
        ClientMessage::StatusUpdate { status } => {
            let friend_ids = registry.get_friend_ids(user_id).await;
            let server_msg = ServerMessage::StatusUpdate {
                user_id: user_id.to_string(),
                status,
            };
            registry.broadcast_to_users(&friend_ids, &server_msg);
            let _ = pubsub::publish_to_users(&friend_ids, &server_msg).await;
        }
        ClientMessage::Ping => {
            let _ = tx.send(ServerMessage::Pong);
        }
        ClientMessage::Authenticate { .. } => {
            // Already authenticated, ignore duplicate auth attempts
        }
        ClientMessage::CallInvite { conversation_id, sdp } => {
            let Some(sender_uuid) = parse_sender_uuid(user_id) else { return };
            let conv_str = conversation_id.to_string();
            if !verify_member(registry, &conv_str, user_id, "call_invite").await {
                return;
            }
            let server_msg = ServerMessage::CallInvite {
                conversation_id,
                sdp,
                from_user_id: sender_uuid,
                from_device_id: None,
            };
            fan_out_to_other_members(registry, &conv_str, user_id, &server_msg).await;
        }
        ClientMessage::CallAnswer { conversation_id, sdp } => {
            let Some(sender_uuid) = parse_sender_uuid(user_id) else { return };
            let conv_str = conversation_id.to_string();
            if !verify_member(registry, &conv_str, user_id, "call_answer").await {
                return;
            }
            let server_msg = ServerMessage::CallAnswer {
                conversation_id,
                sdp,
                from_user_id: sender_uuid,
                from_device_id: None,
            };
            fan_out_to_other_members(registry, &conv_str, user_id, &server_msg).await;

            // Tell every session of every conversation member that the call has
            // been answered, so other ringing UIs clear. The accepting session
            // may receive a redundant copy since we cannot identify the specific
            // socket here; clients ignore it once already in-call.
            let elsewhere = ServerMessage::CallAcceptedElsewhere { conversation_id };
            let members = registry.conversation_members_snapshot(&conv_str).await;
            let mut unique: HashSet<String> = members.into_iter().collect();
            unique.insert(user_id.to_string());
            for member in &unique {
                registry.send_to_user(member, &elsewhere);
            }
            let user_ids: Vec<String> = unique.into_iter().collect();
            let _ = pubsub::publish_to_users(&user_ids, &elsewhere).await;
        }
        ClientMessage::CallDecline { conversation_id, reason } => {
            let Some(sender_uuid) = parse_sender_uuid(user_id) else { return };
            let conv_str = conversation_id.to_string();
            if !verify_member(registry, &conv_str, user_id, "call_decline").await {
                return;
            }
            let server_msg = ServerMessage::CallDecline {
                conversation_id,
                reason,
                from_user_id: sender_uuid,
                from_device_id: None,
            };
            fan_out_to_other_members(registry, &conv_str, user_id, &server_msg).await;
        }
        ClientMessage::CallEnd { conversation_id } => {
            let Some(sender_uuid) = parse_sender_uuid(user_id) else { return };
            let conv_str = conversation_id.to_string();
            if !verify_member(registry, &conv_str, user_id, "call_end").await {
                return;
            }
            let server_msg = ServerMessage::CallEnd {
                conversation_id,
                from_user_id: sender_uuid,
                from_device_id: None,
            };
            fan_out_to_other_members(registry, &conv_str, user_id, &server_msg).await;
        }
        ClientMessage::IceCandidate { conversation_id, candidate } => {
            let Some(sender_uuid) = parse_sender_uuid(user_id) else { return };
            let conv_str = conversation_id.to_string();
            if !verify_member(registry, &conv_str, user_id, "ice_candidate").await {
                return;
            }
            let server_msg = ServerMessage::IceCandidate {
                conversation_id,
                candidate,
                from_user_id: sender_uuid,
                from_device_id: None,
            };
            fan_out_to_other_members(registry, &conv_str, user_id, &server_msg).await;
        }
    }
}

fn parse_sender_uuid(user_id: &str) -> Option<Uuid> {
    Uuid::parse_str(user_id).ok()
}

async fn verify_member(
    registry: &Arc<ConnectionRegistry>,
    conversation_id: &str,
    user_id: &str,
    action: &str,
) -> bool {
    if registry.is_conversation_member(conversation_id, user_id).await {
        true
    } else {
        tracing::warn!(
            "Dropping {} from non-member: user={} conversation={}",
            action,
            user_id,
            conversation_id
        );
        false
    }
}

async fn fan_out_to_other_members(
    registry: &Arc<ConnectionRegistry>,
    conversation_id: &str,
    sender_user_id: &str,
    msg: &ServerMessage,
) {
    registry
        .broadcast_to_conversation(conversation_id, sender_user_id, msg)
        .await;
    let _ = pubsub::publish_to_conversation(conversation_id, sender_user_id, msg).await;
}
