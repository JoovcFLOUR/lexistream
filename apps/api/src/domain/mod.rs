use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct AuthCredentialsRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user_id: Uuid,
    pub email: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabularyItemDto {
    pub id: Uuid,
    pub lemma: String,
    pub normalized_key: String,
    #[serde(default)]
    pub surface_forms: Vec<String>,
    pub language: String,
    pub target_language: String,
    pub primary_translation: String,
    #[serde(default)]
    pub primary_definition: String,
    pub part_of_speech: String,
    #[serde(default)]
    pub meanings: Vec<Value>,
    #[serde(default)]
    pub occurrences: Vec<Value>,
    #[serde(default)]
    pub custom_examples: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_version")]
    pub version: i32,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

fn default_status() -> String {
    "new".to_string()
}

fn default_version() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashcardDto {
    pub id: Uuid,
    pub vocabulary_id: Uuid,
    pub due: String,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: f64,
    pub scheduled_days: f64,
    pub reps: i32,
    pub lapses: i32,
    pub state: i32,
    pub last_review: Option<String>,
    #[serde(default = "default_version")]
    pub version: i32,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewLogDto {
    pub id: Uuid,
    pub flashcard_id: Uuid,
    pub vocabulary_id: Uuid,
    pub rating: String,
    pub state_before: i32,
    pub stability_after: f64,
    pub difficulty_after: f64,
    pub elapsed_days: f64,
    pub scheduled_days: f64,
    pub reviewed_at: String,
    #[serde(default)]
    pub duration_ms: i32,
}

#[derive(Debug, Deserialize)]
pub struct SyncPushRequest {
    pub client_id: String,
    #[serde(default)]
    pub vocabulary_items: Vec<VocabularyItemDto>,
    #[serde(default)]
    pub flashcards: Vec<FlashcardDto>,
    #[serde(default)]
    pub review_logs: Vec<ReviewLogDto>,
}

#[derive(Debug, Serialize)]
pub struct SyncPushResponse {
    pub accepted: usize,
    pub server_seq: i64,
}

#[derive(Debug, Deserialize)]
pub struct SyncPullQuery {
    #[serde(default)]
    pub since_seq: i64,
}

#[derive(Debug, Serialize)]
pub struct SyncPullResponse {
    pub server_seq: i64,
    pub vocabulary_items: Vec<VocabularyItemDto>,
    pub flashcards: Vec<FlashcardDto>,
    pub review_logs: Vec<ReviewLogDto>,
}

#[derive(Debug, Deserialize)]
pub struct TranslationRequestDto {
    pub word: String,
    #[serde(default)]
    pub context: String,
    pub source_language: String,
    pub target_language: String,
}

#[derive(Debug, Serialize)]
pub struct LexicalMeaningDto {
    pub id: String,
    pub part_of_speech: String,
    pub translation: String,
    pub definition: String,
    pub examples: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct TranslationResultDto {
    pub word: String,
    pub lemma: String,
    pub part_of_speech: String,
    pub contextual_translation: String,
    pub definition: String,
    pub context_sentence: String,
    pub context_translation: String,
    pub meanings: Vec<LexicalMeaningDto>,
    pub provider: String,
    pub cached: bool,
}
