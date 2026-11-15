use std::net::SocketAddr;

use lexistream_api::{build_app, run_migrations, AppConfig};
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgres://lexistream:lexistream_dev_password@127.0.0.1:54329/lexistream".to_string()
    });
    let bind_addr: SocketAddr = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8787".to_string())
        .parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(12)
        .connect(&database_url)
        .await?;

    run_migrations(&pool).await?;

    let config = AppConfig {
        deepl_api_key: std::env::var("DEEPL_API_KEY").ok(),
        rate_limit_per_minute: std::env::var("RATE_LIMIT_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(180),
    };

    let app = build_app(pool, config);
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(%bind_addr, "lexistream-api listening");
    axum::serve(listener, app).await?;
    Ok(())
}
