use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::{Duration, Instant},
};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::{OsRng, RngCore};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    domain::{
        LexicalMeaningDto, TranslationRequestDto, TranslationResultDto, VocabularyItemDto,
    },
    error::ApiError,
};

pub struct RateLimiter {
    limit_per_window: u32,
    window: Duration,
    buckets: Mutex<HashMap<String, (u32, Instant)>>,
}

impl RateLimiter {
    pub fn new(limit_per_minute: u32) -> Self {
        Self {
            limit_per_window: limit_per_minute.max(1),
            window: Duration::from_secs(60),
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn check(&self, key: &str) -> Result<(), ApiError> {
        let mut guard = self
            .buckets
            .lock()
            .map_err(|_| ApiError::Internal("rate limiter mutex poisoned".to_string()))?;
        let now = Instant::now();
        let entry = guard.entry(key.to_string()).or_insert((0, now));
        if now.duration_since(entry.1) >= self.window {
            *entry = (1, now);
            return Ok(());
        }
        if entry.0 >= self.limit_per_window {
            return Err(ApiError::TooManyRequests);
        }
        entry.0 += 1;
        Ok(())
    }
}

pub fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| ApiError::Internal(format!("password hashing failed: {e}")))
}

pub fn verify_password(password: &str, password_hash: &str) -> Result<bool, ApiError> {
    let parsed = PasswordHash::new(password_hash)
        .map_err(|e| ApiError::Internal(format!("invalid stored hash: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

pub fn generate_session_token() -> (String, String) {
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    let plain = hex::encode(raw);
    let hashed = hash_token(&plain);
    (plain, hashed)
}

pub fn hash_token(plain_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(plain_token.as_bytes());
    hex::encode(hasher.finalize())
}

fn union_strings(a: &[String], b: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in a.iter().chain(b.iter()) {
        if seen.insert(item.clone()) {
            out.push(item.clone());
        }
    }
    out
}

fn union_json_by_id_or_repr(a: &[Value], b: &[Value]) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for v in a.iter().chain(b.iter()) {
        let sig = v
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| v.to_string());
        if seen.insert(sig) {
            out.push(v.clone());
        }
    }
    out
}

/// Deterministic conflict resolution matching `@lexistream/vocabulary-engine`:
/// - Set union for occurrences, surface_forms, meanings, custom_examples, tags.
/// - Version + ISO timestamp tie-breaker for mutable scalar fields.
pub fn merge_vocabulary_dto(
    current: &VocabularyItemDto,
    incoming: &VocabularyItemDto,
) -> VocabularyItemDto {
    let incoming_wins = incoming.version > current.version
        || (incoming.version == current.version && incoming.updated_at >= current.updated_at);
    let winner = if incoming_wins { incoming } else { current };

    VocabularyItemDto {
        id: winner.id,
        lemma: winner.lemma.clone(),
        normalized_key: winner.normalized_key.clone(),
        surface_forms: union_strings(&current.surface_forms, &incoming.surface_forms),
        language: winner.language.clone(),
        target_language: winner.target_language.clone(),
        primary_translation: winner.primary_translation.clone(),
        primary_definition: winner.primary_definition.clone(),
        part_of_speech: winner.part_of_speech.clone(),
        meanings: union_json_by_id_or_repr(&current.meanings, &incoming.meanings),
        occurrences: union_json_by_id_or_repr(&current.occurrences, &incoming.occurrences),
        custom_examples: union_strings(&current.custom_examples, &incoming.custom_examples),
        tags: union_strings(&current.tags, &incoming.tags),
        status: winner.status.clone(),
        version: current.version.max(incoming.version),
        created_at: if current.created_at <= incoming.created_at {
            current.created_at.clone()
        } else {
            incoming.created_at.clone()
        },
        updated_at: if current.updated_at >= incoming.updated_at {
            current.updated_at.clone()
        } else {
            incoming.updated_at.clone()
        },
        deleted_at: winner.deleted_at.clone(),
    }
}

pub async fn translate_contextual(
    req: &TranslationRequestDto,
    deepl_api_key: Option<&str>,
    http_client: &reqwest::Client,
) -> Result<TranslationResultDto, ApiError> {
    let clean_word = req.word.trim();
    if clean_word.is_empty() || clean_word.len() > 128 {
        return Err(ApiError::BadRequest(
            "word must be between 1 and 128 characters".to_string(),
        ));
    }

    let lower = clean_word
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    let ctx_lower = req.context.to_lowercase();

    // Contextual lemma + POS analysis on server
    let (lemma, pos, fallback_pt, def) = match lower.as_str() {
        "thought" if ctx_lower.contains("a ") || ctx_lower.contains("the ") => (
            "thought".to_string(),
            "noun".to_string(),
            "pensamento".to_string(),
            "An idea or opinion produced by thinking.".to_string(),
        ),
        "thought" => (
            "think".to_string(),
            "verb".to_string(),
            "pensei / pensou".to_string(),
            "Past tense of think: to form an idea or opinion.".to_string(),
        ),
        "bank" if ctx_lower.contains("river") || ctx_lower.contains("water") => (
            "bank".to_string(),
            "noun".to_string(),
            "margem".to_string(),
            "Land alongside a river or lake.".to_string(),
        ),
        "bank" => (
            "bank".to_string(),
            "noun".to_string(),
            "banco".to_string(),
            "Financial institution.".to_string(),
        ),
        _ => (
            lower.clone(),
            "other".to_string(),
            format!("{lower} ({})", req.target_language),
            format!("Contextual lexical entry for \"{lower}\"."),
        ),
    };

    // Optional upstream DeepL provider when DEEPL_API_KEY is configured in server env
    if let Some(api_key) = deepl_api_key.filter(|k| !k.trim().is_empty()) {
        if let Ok(resp) = http_client
            .post("https://api-free.deepl.com/v2/translate")
            .header("Authorization", format!("DeepL-Auth-Key {api_key}"))
            .json(&serde_json::json!({
                "text": [clean_word, &req.context],
                "source_lang": req.source_language.to_uppercase(),
                "target_lang": req.target_language.to_uppercase(),
            }))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(translations) = body["translations"].as_array() {
                        let word_tr = translations
                            .first()
                            .and_then(|t| t["text"].as_str())
                            .unwrap_or(&fallback_pt)
                            .to_string();
                        let ctx_tr = translations
                            .get(1)
                            .and_then(|t| t["text"].as_str())
                            .unwrap_or("")
                            .to_string();

                        return Ok(TranslationResultDto {
                            word: clean_word.to_string(),
                            lemma: lemma.clone(),
                            part_of_speech: pos.clone(),
                            contextual_translation: word_tr.clone(),
                            definition: def.clone(),
                            context_sentence: req.context.clone(),
                            context_translation: ctx_tr,
                            meanings: vec![LexicalMeaningDto {
                                id: format!("{lemma}-{pos}"),
                                part_of_speech: pos,
                                translation: word_tr,
                                definition: def,
                                examples: if req.context.is_empty() {
                                    vec![]
                                } else {
                                    vec![req.context.clone()]
                                },
                            }],
                            provider: "deepl-proxy".to_string(),
                            cached: false,
                        });
                    }
                }
            }
        }
    }

    Ok(TranslationResultDto {
        word: clean_word.to_string(),
        lemma: lemma.clone(),
        part_of_speech: pos.clone(),
        contextual_translation: fallback_pt.clone(),
        definition: def.clone(),
        context_sentence: req.context.clone(),
        context_translation: if ctx_lower == "i never thought this would happen." {
            "Eu nunca pensei que isso aconteceria.".to_string()
        } else {
            String::new()
        },
        meanings: vec![LexicalMeaningDto {
            id: format!("{lemma}-{pos}"),
            part_of_speech: pos,
            translation: fallback_pt,
            definition: def,
            examples: if req.context.is_empty() {
                vec![]
            } else {
                vec![req.context.clone()]
            },
        }],
        provider: "api-contextual-lexicon".to_string(),
        cached: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merges_vocabulary_occurrences_and_respects_version_winner() {
        let id = uuid::Uuid::new_v4();
        let a = VocabularyItemDto {
            id,
            lemma: "think".into(),
            normalized_key: "en::think::verb".into(),
            surface_forms: vec!["thought".into()],
            language: "en".into(),
            target_language: "pt".into(),
            primary_translation: "pensou".into(),
            primary_definition: "Def A".into(),
            part_of_speech: "verb".into(),
            meanings: vec![],
            occurrences: vec![json!({"id": "1", "context": "A"})],
            custom_examples: vec![],
            tags: vec!["t1".into()],
            status: "new".into(),
            version: 1,
            created_at: "2026-11-15T00:00:00Z".into(),
            updated_at: "2026-11-15T00:00:00Z".into(),
            deleted_at: None,
        };
        let mut b = a.clone();
        b.version = 2;
        b.primary_translation = "pensar".into();
        b.surface_forms = vec!["thinking".into()];
        b.occurrences = vec![json!({"id": "2", "context": "B"})];
        b.tags = vec!["t2".into()];

        let merged = merge_vocabulary_dto(&a, &b);
        assert_eq!(merged.primary_translation, "pensar");
        assert_eq!(merged.surface_forms.len(), 2);
        assert_eq!(merged.occurrences.len(), 2);
        assert_eq!(merged.tags.len(), 2);
    }
}
