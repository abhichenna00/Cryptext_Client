use aws_sdk_secretsmanager::Client as SecretsClient;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::OnceCell;

static CONFIG: OnceCell<Arc<AppConfig>> = OnceCell::const_new();

/// Maps exactly to the keys in your Secrets Manager JSON
#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub database_url: String,
    pub cognito_user_pool_id: String,
    pub cognito_client_id: String,
    pub s3_bucket: String,
    pub cloudfront_url: String,
    pub websocket_url: String,
    pub cognito_client_secret: String,
    pub cognito_domain: String,
    pub google_redirect_uri: String,
    pub entra_redirect_uri: String,
    /// Name of the Cognito User Pool identity provider for Entra. Must match
    /// exactly what's configured on the Cognito app client — Cognito's Hosted
    /// UI rejects unknown values with an opaque 400. Defaulted to "Entra" when
    /// omitted from the secret payload.
    #[serde(default = "default_entra_provider_name")]
    pub entra_provider_name: String,

    // These are not in Secrets Manager but read from environment
    #[serde(skip)]
    pub aws_region: String,
    #[serde(skip)]
    pub host: String,
    #[serde(skip)]
    pub port: u16,
    #[serde(skip)]
    pub secret_name: String,
}

fn default_entra_provider_name() -> String {
    "Entra".to_string()
}

/// Load config once at startup — panics if secrets cannot be fetched
pub async fn init_config() -> Result<(), Box<dyn std::error::Error>> {
    let aws_region = std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-2".to_string());
    let secret_name = std::env::var("SECRET_NAME").unwrap_or_else(|_| "cryptext/server-config".to_string());
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .unwrap_or(8080);

    tracing::info!("Fetching secrets from AWS Secrets Manager: {}", secret_name);

    let sdk_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(aws_region.clone()))
        .load()
        .await;

    let client = SecretsClient::new(&sdk_config);

    let response = client
        .get_secret_value()
        .secret_id(&secret_name)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch secret '{}': {}", secret_name, e))?;

    let secret_string = response
        .secret_string()
        .ok_or("Secret has no string value")?;

    let mut config: AppConfig = serde_json::from_str(secret_string)
        .map_err(|e| format!("Failed to parse secret JSON: {}", e))?;

    // Inject non-secret env values
    config.aws_region = aws_region;
    config.host = host;
    config.port = port;
    config.secret_name = secret_name;

    CONFIG
        .set(Arc::new(config))
        .map_err(|_| "Config already initialized")?;

    tracing::info!("Config loaded successfully from Secrets Manager");
    Ok(())
}

/// Get the global config — panics if called before init_config()
pub fn get_config() -> &'static Arc<AppConfig> {
    CONFIG.get().expect("Config not initialized — call init_config() first")
}
