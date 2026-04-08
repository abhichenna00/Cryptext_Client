use redis::aio::ConnectionManager;
use tokio::sync::OnceCell;

static REDIS: OnceCell<ConnectionManager> = OnceCell::const_new();

/// Initialize the Redis connection pool. Call once at startup.
pub async fn init_redis() -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://redis:6379".to_string());

    tracing::info!("Connecting to Redis at: {}", redis_url);

    let client = redis::Client::open(redis_url)?;
    let manager = ConnectionManager::new(client).await?;

    REDIS
        .set(manager)
        .map_err(|_| "Redis already initialized")?;

    tracing::info!("Redis connection established");
    Ok(())
}

/// Get the Redis connection manager. Panics if called before init_redis().
pub fn get_redis() -> ConnectionManager {
    REDIS
        .get()
        .expect("Redis not initialized — call init_redis() first")
        .clone()
}
