use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("validation error: {0}")]
    BadRequest(String),

    #[error("unauthorized: {0}")]
    Unauthorized(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("rate limit exceeded")]
    TooManyRequests,

    #[error("database error")]
    Database(#[from] sqlx::Error),

    #[error("internal server error: {0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            Self::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            Self::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            Self::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "Rate limit exceeded. Try again shortly.".to_string(),
            ),
            Self::Database(err) => {
                tracing::error!(error = ?err, "database query failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal database error".to_string(),
                )
            }
            Self::Internal(msg) => {
                tracing::error!(error = %msg, "internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}
