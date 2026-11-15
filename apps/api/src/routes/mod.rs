use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    database::{
        current_server_seq, insert_review_log, pull_changes_since, upsert_flashcard,
        upsert_vocabulary_item,
    },
    domain::{
        AuthCredentialsRequest, AuthResponse, SyncPullQuery, SyncPullResponse, SyncPushRequest,
        SyncPushResponse, TranslationRequestDto, TranslationResultDto,
    },
    error::ApiError,
    services::{
        generate_session_token, hash_password, hash_token, translate_contextual, verify_password,
    },
    AppState,
};

pub async fn health_handler(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    sqlx::query("SELECT 1").execute(&state.pool).await?;
    Ok(Json(json!({
        "status": "ok",
        "service": "lexistream-api"
    })))
}

pub async fn register_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthCredentialsRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), ApiError> {
    let email = payload.email.trim().to_lowercase();
    if !email.contains('@') || email.len() < 5 {
        return Err(ApiError::BadRequest("valid email is required".to_string()));
    }
    if payload.password.len() < 8 {
        return Err(ApiError::BadRequest(
            "password must be at least 8 characters".to_string(),
        ));
    }

    state.rate_limiter.check(&format!("auth:{email}"))?;

    let existing = sqlx::query("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await?;
    if existing.is_some() {
        return Err(ApiError::Conflict("email already registered".to_string()));
    }

    let user_id = Uuid::new_v4();
    let pw_hash = hash_password(&payload.password)?;

    sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(&email)
        .bind(&pw_hash)
        .execute(&state.pool)
        .await?;

    let (plain_token, token_hash) = generate_session_token();
    let expires_at = Utc::now() + Duration::days(30);
    sqlx::query(
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(&token_hash)
    .bind(user_id)
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            user_id,
            email,
            token: plain_token,
        }),
    ))
}

pub async fn login_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthCredentialsRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let email = payload.email.trim().to_lowercase();
    state.rate_limiter.check(&format!("auth:{email}"))?;

    let row = sqlx::query("SELECT id, password_hash FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("invalid email or password".to_string()))?;

    let user_id: Uuid = row.try_get("id")?;
    let pw_hash: String = row.try_get("password_hash")?;

    if !verify_password(&payload.password, &pw_hash)? {
        return Err(ApiError::Unauthorized(
            "invalid email or password".to_string(),
        ));
    }

    let (plain_token, token_hash) = generate_session_token();
    let expires_at = Utc::now() + Duration::days(30);
    sqlx::query(
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(&token_hash)
    .bind(user_id)
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(AuthResponse {
        user_id,
        email,
        token: plain_token,
    }))
}

pub async fn delete_account_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let user_id = authenticate_user(&state, &headers).await?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn sync_push_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<SyncPushRequest>,
) -> Result<Json<SyncPushResponse>, ApiError> {
    let user_id = authenticate_user(&state, &headers).await?;
    state.rate_limiter.check(&format!("sync:{user_id}"))?;

    let mut accepted = 0usize;
    for item in &payload.vocabulary_items {
        upsert_vocabulary_item(&state.pool, user_id, item).await?;
        accepted += 1;
    }
    for card in &payload.flashcards {
        upsert_flashcard(&state.pool, user_id, card).await?;
        accepted += 1;
    }
    for log in &payload.review_logs {
        insert_review_log(&state.pool, user_id, log).await?;
        accepted += 1;
    }

    let server_seq = current_server_seq(&state.pool).await?;
    Ok(Json(SyncPushResponse {
        accepted,
        server_seq,
    }))
}

pub async fn sync_pull_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<SyncPullQuery>,
) -> Result<Json<SyncPullResponse>, ApiError> {
    let user_id = authenticate_user(&state, &headers).await?;
    state.rate_limiter.check(&format!("sync:{user_id}"))?;

    let (vocabulary_items, flashcards, review_logs) =
        pull_changes_since(&state.pool, user_id, query.since_seq).await?;
    let server_seq = current_server_seq(&state.pool).await?;

    Ok(Json(SyncPullResponse {
        server_seq,
        vocabulary_items,
        flashcards,
        review_logs,
    }))
}

pub async fn translate_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<TranslationRequestDto>,
) -> Result<Json<TranslationResultDto>, ApiError> {
    let bucket_key = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("anonymous-translate");
    state.rate_limiter.check(bucket_key)?;

    let res = translate_contextual(
        &payload,
        state.config.deepl_api_key.as_deref(),
        &state.http_client,
    )
    .await?;
    Ok(Json(res))
}

async fn authenticate_user(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    let raw_header = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| ApiError::Unauthorized("missing Authorization header".to_string()))?;

    let token = raw_header
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::Unauthorized("expected Bearer token".to_string()))?;

    let token_hash = hash_token(token);
    let row = sqlx::query(
        "SELECT user_id FROM auth_sessions WHERE token_hash = $1 AND expires_at > NOW()",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::Unauthorized("invalid or expired session token".to_string()))?;

    let user_id: Uuid = row.try_get("user_id")?;
    Ok(user_id)
}
