use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use lexistream_api::{build_app, run_migrations, AppConfig};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

async fn setup_test_app() -> axum::Router {
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgres://lexistream:lexistream_dev_password@127.0.0.1:54329/lexistream".to_string()
    });
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("connect to postgres");
    run_migrations(&pool).await.expect("run migrations");
    build_app(
        pool,
        AppConfig {
            deepl_api_key: None,
            rate_limit_per_minute: 50,
        },
    )
}

async fn read_json(resp: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .expect("body bytes");
    serde_json::from_slice(&bytes).expect("valid json")
}

#[tokio::test]
async fn health_auth_sync_conflict_merge_translate_and_gdpr_delete() {
    let app = setup_test_app().await;

    // 1. Health check
    let health_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health_resp.status(), StatusCode::OK);

    // 2. Register unique user
    let unique_email = format!("learner-{}@example.com", Uuid::new_v4());
    let reg_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": unique_email,
                        "password": "StrongPassword123!"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reg_resp.status(), StatusCode::CREATED);
    let reg_json = read_json(reg_resp).await;
    let token = reg_json["token"].as_str().expect("auth token").to_string();

    // 3. Push vocabulary item from Device A
    let item_id = Uuid::new_v4();
    let push_a = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/sync/push")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(
                    json!({
                        "client_id": "device-a",
                        "vocabulary_items": [{
                            "id": item_id,
                            "lemma": "think",
                            "normalized_key": "en::think::verb",
                            "surface_forms": ["thought"],
                            "language": "en",
                            "target_language": "pt",
                            "primary_translation": "pensou",
                            "primary_definition": "To form an idea.",
                            "part_of_speech": "verb",
                            "meanings": [],
                            "occurrences": [{
                                "id": "occ-a",
                                "surface_form": "thought",
                                "context": "I never thought this would happen.",
                                "context_translation": "Eu nunca pensei que isso aconteceria.",
                                "video_id": "vid_a",
                                "video_title": "Video A",
                                "video_url": "https://www.youtube.com/watch?v=vid_a",
                                "timestamp": 125.4,
                                "captured_at": "2026-11-15T10:00:00Z"
                            }],
                            "custom_examples": [],
                            "tags": ["verbs"],
                            "status": "new",
                            "version": 1,
                            "created_at": "2026-11-15T10:00:00Z",
                            "updated_at": "2026-11-15T10:00:00Z",
                            "deleted_at": null
                        }],
                        "flashcards": [],
                        "review_logs": []
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(push_a.status(), StatusCode::OK);

    // 4. Push concurrent update from Device B with new occurrence + higher version
    let push_b = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/sync/push")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(
                    json!({
                        "client_id": "device-b",
                        "vocabulary_items": [{
                            "id": item_id,
                            "lemma": "think",
                            "normalized_key": "en::think::verb",
                            "surface_forms": ["thinking"],
                            "language": "en",
                            "target_language": "pt",
                            "primary_translation": "pensar / refletir",
                            "primary_definition": "Updated definition.",
                            "part_of_speech": "verb",
                            "meanings": [],
                            "occurrences": [{
                                "id": "occ-b",
                                "surface_form": "thinking",
                                "context": "She was thinking deeply.",
                                "context_translation": "Ela estava pensando profundamente.",
                                "video_id": "vid_b",
                                "video_title": "Video B",
                                "video_url": "https://www.youtube.com/watch?v=vid_b",
                                "timestamp": 42.0,
                                "captured_at": "2026-11-15T11:00:00Z"
                            }],
                            "custom_examples": ["Think before acting."],
                            "tags": ["core"],
                            "status": "learning",
                            "version": 2,
                            "created_at": "2026-11-15T10:00:00Z",
                            "updated_at": "2026-11-15T11:00:00Z",
                            "deleted_at": null
                        }],
                        "flashcards": [],
                        "review_logs": []
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(push_b.status(), StatusCode::OK);

    // 5. Pull delta since_seq=0 -> merged item preserves BOTH occurrences and surface forms!
    let pull_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/sync/pull?since_seq=0")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pull_resp.status(), StatusCode::OK);
    let pull_json = read_json(pull_resp).await;
    let pulled_items = pull_json["vocabulary_items"].as_array().unwrap();
    assert_eq!(pulled_items.len(), 1);
    assert_eq!(pulled_items[0]["primary_translation"], "pensar / refletir");
    assert_eq!(pulled_items[0]["occurrences"].as_array().unwrap().len(), 2);
    assert_eq!(pulled_items[0]["surface_forms"].as_array().unwrap().len(), 2);

    // 6. Translate endpoint works without leaking keys
    let trans_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/translate")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "word": "thought",
                        "context": "I never thought this would happen.",
                        "source_language": "en",
                        "target_language": "pt"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(trans_resp.status(), StatusCode::OK);
    let trans_json = read_json(trans_resp).await;
    assert_eq!(trans_json["lemma"], "think");

    // 7. Delete account -> erases user & cascades all vocabulary/sessions
    let del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/v1/auth/account")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_resp.status(), StatusCode::NO_CONTENT);

    // Subsequent sync pull with deleted session returns 401 Unauthorized
    let unauth_resp = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/sync/pull?since_seq=0")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauth_resp.status(), StatusCode::UNAUTHORIZED);
}
