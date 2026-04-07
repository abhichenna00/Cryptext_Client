pub mod cognito;
pub mod conversations;
pub mod friends;
pub mod media;
pub mod mls;
pub mod profile;
pub mod google_oauth;

use axum::{
    routing::{delete, get, post, put},
    Router,
};
use std::sync::Arc;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};

pub fn build_router() -> Router {
    // Rate limit for message sending: 30 messages per second, burst of 10
    let msg_rate_limit = GovernorConfigBuilder::default()
        .per_second(30)
        .burst_size(10)
        .finish()
        .expect("Failed to build message rate limit config");

    Router::new()
        // Health
        .route("/health", get(health))

        //WebsocketAccess
        .route("/config/ws", get(get_ws_config))

        // Auth routes (no JWT required)
        .route("/auth/signin", post(cognito::sign_in))
        .route("/auth/signup", post(cognito::sign_up))
        .route("/auth/confirm", post(cognito::confirm_sign_up))
        .route("/auth/refresh", post(cognito::refresh_token))

        // Google Auth Routes
        .route("/auth/google/start", post(google_oauth::start_google_auth))
        .route("/auth/google/callback", get(google_oauth::google_callback))
        .route("/auth/google/status", get(google_oauth::google_auth_status))

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
        .route("/conversations/:id/messages", get(conversations::get_messages))
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
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "status": "ok", "version": "0.1.0" }))
}

async fn get_ws_config() -> axum::Json<serde_json::Value> {
    let config = crate::config::get_config();
    axum::Json(serde_json::json!({ "ws_url": config.websocket_url }))
}