mod auth;
mod config;
mod db;
mod error;
pub mod redis;
mod routes;

use axum::Router;
use std::net::SocketAddr;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
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

    let app_config = config::get_config();

    // 3. Build router
    let cors = CorsLayer::new()
        .allow_origin(Any) // Tighten this in production if needed
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .merge(routes::build_router())
        .layer(cors)
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
