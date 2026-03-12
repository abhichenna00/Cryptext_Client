use crate::config::get_config;
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::sync::Arc;
use tokio::sync::OnceCell;

static DB_POOL: OnceCell<Arc<PgPool>> = OnceCell::const_new();

/// Initialize the database pool — call once at startup
pub async fn init_db() -> Result<(), sqlx::Error> {
    let config = get_config();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .min_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&config.database_url)
        .await?;

    // Verify connectivity
    sqlx::query("SELECT 1").execute(&pool).await?;

    DB_POOL
        .set(Arc::new(pool))
        .map_err(|_| sqlx::Error::Configuration("Pool already initialized".into()))?;

    tracing::info!("Database pool initialized successfully");
    Ok(())
}

/// Get the database pool — panics if called before init_db()
pub fn get_pool() -> &'static Arc<PgPool> {
    DB_POOL.get().expect("Database pool not initialized — call init_db() first")
}
