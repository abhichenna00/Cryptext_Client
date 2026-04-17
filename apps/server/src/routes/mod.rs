pub mod cognito;
pub mod conversations;
pub mod friends;
pub mod media;
pub mod mls;
pub mod profile;
pub mod google_oauth;
pub mod sync;

use axum::{
    routing::{delete, get, post, put},
    Router,
};
use std::sync::Arc;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};

pub fn build_router() -> Router {
    // Per-IP rate limits.
    //
    //   - Global: 60 req/s, burst 30. Applied to the whole router below.
    //     Covers /profile, /profiles, /friends/*, /media/*, /sync/*, /mls/*,
    //     /conversations (read-only), etc.
    //
    //   - Auth sublayer: tight limit (1 req/5s, burst 5 = effectively ~5/min
    //     sustained with brief bursts) wrapping /auth/*. Makes credential
    //     stuffing, signup flooding, and confirmation-code brute force
    //     (10^6 code space) infeasible without distributed traffic.
    //
    //   - Per-route: message send keeps its existing 30/s burst 10 on top
    //     of the global layer.
    let global_rate_limit = GovernorConfigBuilder::default()
        .per_second(60)
        .burst_size(30)
        .finish()
        .expect("Failed to build global rate limit config");
    let auth_rate_limit = GovernorConfigBuilder::default()
        .per_millisecond(5_000)
        .burst_size(5)
        .finish()
        .expect("Failed to build auth rate limit config");
    let msg_rate_limit = GovernorConfigBuilder::default()
        .per_second(30)
        .burst_size(10)
        .finish()
        .expect("Failed to build message rate limit config");

    let auth_routes = Router::new()
        .route("/auth/signin", post(cognito::sign_in))
        .route("/auth/signup", post(cognito::sign_up))
        .route("/auth/confirm", post(cognito::confirm_sign_up))
        .route("/auth/refresh", post(cognito::refresh_token))
        .route("/auth/google/start", post(google_oauth::start_google_auth))
        .route("/auth/google/callback", get(google_oauth::google_callback))
        .route("/auth/google/status", get(google_oauth::google_auth_status))
        .layer(GovernorLayer {
            config: Arc::new(auth_rate_limit),
        });

    Router::new()
        // Health
        .route("/health", get(health))

        // WebSocket
        .route("/ws", get(crate::ws::handler::ws_handler))
        .route("/config/ws", get(get_ws_config))

        // Auth routes (no JWT required, tight per-IP limit)
        .merge(auth_routes)

        // Profile routes
        .route("/profile", get(profile::get_profile))
        .route("/profile", post(profile::create_profile))
        .route("/profile", put(profile::update_profile))
        .route("/profile/exists", get(profile::check_profile_exists))
        .route("/profile/status", put(profile::update_status))
        .route("/profile/avatar", post(profile::upload_profile_image))
        .route("/profile/avatar", delete(profile::delete_profile_image))
        .route("/profile/placeholder", get(profile::generate_placeholder_profile))
        .route("/profiles", post(profile::get_profiles_by_ids))

        // Friends routes
        .route("/friends", get(friends::get_friends))
        .route("/friends/:friend_id", delete(friends::remove_friend))
        .route("/friends/requests/send", post(friends::send_friend_request))
        .route("/friends/requests/incoming", get(friends::get_incoming_friend_requests))
        .route("/friends/requests/outgoing", get(friends::get_outgoing_friend_requests))
        .route("/friends/requests/:id/accept", post(friends::accept_friend_request))
        .route("/friends/requests/:id/decline", post(friends::decline_friend_request))
        .route("/friends/requests/:id/cancel", delete(friends::cancel_friend_request))

        // Conversation routes
        .route("/conversations", get(conversations::get_conversations))
        .route("/conversations/dm", post(conversations::get_or_create_dm_conversation))
        .route("/conversations/group", post(conversations::create_group_conversation))
        .route("/conversations/:id/messages", get(conversations::get_messages))
        .route("/conversations/:id/members", get(conversations::get_group_members))
        .route("/conversations/:id/read", post(conversations::mark_conversation_read))

        // Rate-limited message sending
        .nest("/conversations/:id", Router::new()
            .route("/messages", post(conversations::send_message))
            .layer(GovernorLayer {
                config: Arc::new(msg_rate_limit),
            })
        )

        // Media routes
        .route("/media/upload", post(media::upload))
        .route("/media/download", get(media::download))

        // Sync routes (encrypted state backup)
        .route("/sync/vault", put(sync::upload_vault))
        .route("/sync/vault", get(sync::download_vault))
        .route("/sync/mls-state", put(sync::upload_mls_state))
        .route("/sync/mls-state", get(sync::download_mls_state))
        .route("/sync/messages-db", put(sync::upload_messages_db))
        .route("/sync/messages-db", get(sync::download_messages_db))
        .route("/sync", delete(sync::delete_all_sync_data))
        .route("/sync/exists", get(sync::check_sync_exists))

        // MLS routes
        .route("/mls/key-packages", post(mls::upload_key_packages))
        .route("/mls/key-packages", delete(mls::delete_key_packages))
        .route("/mls/key-packages/:user_id", get(mls::claim_key_package))
        .route("/mls/key-packages/count", get(mls::key_package_count))
        .route("/mls/groups", post(mls::register_group))
        .route("/mls/welcome", post(mls::store_welcome))
        .route("/mls/welcome", get(mls::fetch_welcomes))
        .route("/mls/commit", post(mls::fan_out_commit))
        .route("/mls/welcome-ack", post(mls::welcome_ack))

        // Global per-IP rate limit applied to everything above.
        // The auth and message-send sublayers above stack on top of this.
        .layer(GovernorLayer {
            config: Arc::new(global_rate_limit),
        })
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "status": "ok", "version": "0.1.0" }))
}

async fn get_ws_config() -> axum::Json<serde_json::Value> {
    // Return the server's own /ws endpoint instead of an external API Gateway URL.
    // The client derives the WS URL from SERVER_URL, so this is a fallback.
    let config = crate::config::get_config();
    let ws_url = config
        .websocket_url
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    // If the old config still points to API Gateway, override with self-referencing URL
    let ws_url = if ws_url.contains("/ws") {
        ws_url
    } else {
        format!("{}/ws", ws_url)
    };
    axum::Json(serde_json::json!({ "ws_url": ws_url }))
}