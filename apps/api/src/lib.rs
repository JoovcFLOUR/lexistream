pub mod database;
pub mod domain;
pub mod error;
pub mod routes;
pub mod services;

use std::{sync::Arc, time::Duration};

use axum::{
    routing::{delete, get, post},
    Router,
};
use services::RateLimiter;
use sqlx::PgPool;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct AppConfig {
    pub deepl_api_key: Option<String>,
    pub rate_limit_per_minute: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            deepl_api_key: None,
            rate_limit_per_minute: 120,
        }
    }
}

pub struct AppState {
    pub pool: PgPool,
    pub config: AppConfig,
    pub rate_limiter: RateLimiter,
    pub http_client: reqwest::Client,
}

#[must_use = "handle migration errors before starting server"]
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    database::run_schema_migrations(pool).await
}

pub fn build_app(pool: PgPool, config: AppConfig) -> Router {
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let rate_limiter = RateLimiter::new(config.rate_limit_per_minute);
    let state = Arc::new(AppState {
        pool,
        config,
        rate_limiter,
        http_client,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/v1/health", get(routes::health_handler))
        .route("/api/v1/auth/register", post(routes::register_handler))
        .route("/api/v1/auth/login", post(routes::login_handler))
        .route("/api/v1/auth/account", delete(routes::delete_account_handler))
        .route("/api/v1/sync/push", post(routes::sync_push_handler))
        .route("/api/v1/sync/pull", get(routes::sync_pull_handler))
        .route("/api/v1/translate", post(routes::translate_handler))
        .layer(cors)
        .with_state(state)
}
