use aws_sdk_s3::Client as S3Client;
use tokio::sync::OnceCell;

static S3_CLIENT: OnceCell<S3Client> = OnceCell::const_new();

/// Initialize the S3 client. Call once at startup so handlers don't pay
/// the ~10-50ms SDK config load on every request.
pub async fn init_s3() -> Result<(), Box<dyn std::error::Error>> {
    let config_ref = crate::config::get_config();
    let sdk_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(config_ref.aws_region.clone()))
        .load()
        .await;
    let client = S3Client::new(&sdk_config);
    S3_CLIENT
        .set(client)
        .map_err(|_| "S3 client already initialized")?;
    tracing::info!("S3 client initialized");
    Ok(())
}

/// Get the shared S3 client. Panics if called before init_s3().
pub fn get_s3() -> &'static S3Client {
    S3_CLIENT
        .get()
        .expect("S3 client not initialized — call init_s3() first")
}
