pub mod auth;
mod config;
mod db;
mod error;
pub mod redis;
mod routes;
mod s3;
mod ws;

use axum::{
    http::{header, HeaderValue, Method},
    Extension, Router,
};
use std::net::SocketAddr;
use tower_http::{
    cors::CorsLayer, set_header::SetResponseHeaderLayer, trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "cryptext_server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Cryptext server...");

    // 1. Load config from Secrets Manager
    if let Err(e) = config::init_config().await {
        tracing::error!("Failed to load config: {}", e);
        std::process::exit(1);
    }

    // 2. Initialize database pool
    if let Err(e) = db::init_db().await {
        tracing::error!("Failed to initialize database: {}", e);
        std::process::exit(1);
    }

    // 3. Initialize Redis
    if let Err(e) = redis::init_redis().await {
        tracing::error!("Failed to connect to Redis: {}", e);
        std::process::exit(1);
    }

    // 4. Initialize S3 client (shared across profile/media/sync routes)
    if let Err(e) = s3::init_s3().await {
        tracing::error!("Failed to initialize S3 client: {}", e);
        std::process::exit(1);
    }

    // 5. Initialize WebSocket infrastructure
    ws::pubsub::init_instance_id();
    let registry = ws::state::ConnectionRegistry::new();

    if let Err(e) = ws::pubsub::spawn_subscriber(registry.clone()).await {
        tracing::error!("Failed to start Redis pub/sub subscriber: {}", e);
        std::process::exit(1);
    }

    let app_config = config::get_config();

    // 5. Build router
    // Scoped CORS: the Tauri client reaches this server from reqwest in the
    // Rust backend and doesn't send an Origin header, so this policy is
    // primarily for future browser clients and dev tooling. Explicit allow
    // list stops any random web origin from calling these endpoints.
    let cors = CorsLayer::new()
        .allow_origin([
            "tauri://localhost".parse().expect("valid origin"),
            "https://tauri.localhost".parse().expect("valid origin"),
            "http://localhost:1420".parse().expect("valid origin"),
        ])
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    // Security headers applied to every response. This is a JSON API, so the
    // CSP is deliberately restrictive (blocks any content from loading if a
    // response is ever interpreted as HTML by a browser).
    let security_headers = tower::ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
        ));

    let app = Router::new()
        .merge(routes::build_router())
        .layer(Extension(registry))
        .layer(cors)
        .layer(security_headers)
        .layer(TraceLayer::new_for_http());

    // 4. Bind and serve
    let addr: SocketAddr = format!("{}:{}", app_config.host, app_config.port)
        .parse()
        .expect("Invalid host/port");

    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind address");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .expect("Server error");
}
