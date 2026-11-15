use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    domain::{FlashcardDto, ReviewLogDto, VocabularyItemDto},
    error::ApiError,
    services::merge_vocabulary_dto,
};

pub async fn run_schema_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    let raw_sql = include_str!("../../migrations/0001_init.sql");
    for statement in raw_sql.split(';') {
        let trimmed = statement.trim();
        if !trimmed.is_empty() {
            sqlx::query(trimmed).execute(pool).await?;
        }
    }
    Ok(())
}

pub(crate) async fn current_server_seq(pool: &PgPool) -> Result<i64, ApiError> {
    let row = sqlx::query("SELECT last_value, is_called FROM sync_global_seq")
        .fetch_one(pool)
        .await?;
    let last_val: i64 = row.try_get("last_value")?;
    let is_called: bool = row.try_get("is_called")?;
    Ok(if is_called { last_val } else { 0 })
}

pub(crate) async fn upsert_vocabulary_item(
    pool: &PgPool,
    user_id: Uuid,
    incoming: &VocabularyItemDto,
) -> Result<(), ApiError> {
    let existing_row = sqlx::query(
        r#"
        SELECT id, lemma, normalized_key, surface_forms, language, target_language,
               primary_translation, primary_definition, part_of_speech, meanings,
               occurrences, custom_examples, tags, status, version, created_at,
               updated_at, deleted_at
        FROM vocabulary_items
        WHERE user_id = $1 AND id = $2
        "#,
    )
    .bind(user_id)
    .bind(incoming.id)
    .fetch_optional(pool)
    .await?;

    let merged = if let Some(row) = existing_row {
        let current = row_to_vocab_dto(&row)?;
        merge_vocabulary_dto(&current, incoming)
    } else {
        incoming.clone()
    };

    sqlx::query(
        r#"
        INSERT INTO vocabulary_items (
            user_id, id, lemma, normalized_key, surface_forms, language, target_language,
            primary_translation, primary_definition, part_of_speech, meanings, occurrences,
            custom_examples, tags, status, version, created_at, updated_at, deleted_at, sync_seq
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, nextval('sync_global_seq')
        )
        ON CONFLICT (user_id, id) DO UPDATE SET
            lemma = EXCLUDED.lemma,
            normalized_key = EXCLUDED.normalized_key,
            surface_forms = EXCLUDED.surface_forms,
            language = EXCLUDED.language,
            target_language = EXCLUDED.target_language,
            primary_translation = EXCLUDED.primary_translation,
            primary_definition = EXCLUDED.primary_definition,
            part_of_speech = EXCLUDED.part_of_speech,
            meanings = EXCLUDED.meanings,
            occurrences = EXCLUDED.occurrences,
            custom_examples = EXCLUDED.custom_examples,
            tags = EXCLUDED.tags,
            status = EXCLUDED.status,
            version = EXCLUDED.version,
            updated_at = EXCLUDED.updated_at,
            deleted_at = EXCLUDED.deleted_at,
            sync_seq = nextval('sync_global_seq')
        "#,
    )
    .bind(user_id)
    .bind(merged.id)
    .bind(&merged.lemma)
    .bind(&merged.normalized_key)
    .bind(serde_json::to_value(&merged.surface_forms).unwrap_or_default())
    .bind(&merged.language)
    .bind(&merged.target_language)
    .bind(&merged.primary_translation)
    .bind(&merged.primary_definition)
    .bind(&merged.part_of_speech)
    .bind(serde_json::to_value(&merged.meanings).unwrap_or_default())
    .bind(serde_json::to_value(&merged.occurrences).unwrap_or_default())
    .bind(serde_json::to_value(&merged.custom_examples).unwrap_or_default())
    .bind(serde_json::to_value(&merged.tags).unwrap_or_default())
    .bind(&merged.status)
    .bind(merged.version)
    .bind(&merged.created_at)
    .bind(&merged.updated_at)
    .bind(&merged.deleted_at)
    .execute(pool)
    .await?;

    Ok(())
}

pub(crate) async fn upsert_flashcard(
    pool: &PgPool,
    user_id: Uuid,
    card: &FlashcardDto,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO flashcards (
            user_id, id, vocabulary_id, due, stability, difficulty, elapsed_days,
            scheduled_days, reps, lapses, state, last_review, version, updated_at, sync_seq
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, nextval('sync_global_seq'))
        ON CONFLICT (user_id, id) DO UPDATE SET
            due = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.due ELSE flashcards.due END,
            stability = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.stability ELSE flashcards.stability END,
            difficulty = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.difficulty ELSE flashcards.difficulty END,
            elapsed_days = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.elapsed_days ELSE flashcards.elapsed_days END,
            scheduled_days = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.scheduled_days ELSE flashcards.scheduled_days END,
            reps = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.reps ELSE flashcards.reps END,
            lapses = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.lapses ELSE flashcards.lapses END,
            state = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.state ELSE flashcards.state END,
            last_review = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.last_review ELSE flashcards.last_review END,
            version = GREATEST(flashcards.version, EXCLUDED.version),
            updated_at = CASE WHEN EXCLUDED.version >= flashcards.version THEN EXCLUDED.updated_at ELSE flashcards.updated_at END,
            sync_seq = nextval('sync_global_seq')
        "#,
    )
    .bind(user_id)
    .bind(card.id)
    .bind(card.vocabulary_id)
    .bind(&card.due)
    .bind(card.stability)
    .bind(card.difficulty)
    .bind(card.elapsed_days)
    .bind(card.scheduled_days)
    .bind(card.reps)
    .bind(card.lapses)
    .bind(card.state)
    .bind(&card.last_review)
    .bind(card.version)
    .bind(&card.updated_at)
    .execute(pool)
    .await?;

    Ok(())
}

pub(crate) async fn insert_review_log(
    pool: &PgPool,
    user_id: Uuid,
    log: &ReviewLogDto,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO review_logs (
            user_id, id, flashcard_id, vocabulary_id, rating, state_before,
            stability_after, difficulty_after, elapsed_days, scheduled_days,
            reviewed_at, duration_ms, sync_seq
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, nextval('sync_global_seq'))
        ON CONFLICT (user_id, id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(log.id)
    .bind(log.flashcard_id)
    .bind(log.vocabulary_id)
    .bind(&log.rating)
    .bind(log.state_before)
    .bind(log.stability_after)
    .bind(log.difficulty_after)
    .bind(log.elapsed_days)
    .bind(log.scheduled_days)
    .bind(&log.reviewed_at)
    .bind(log.duration_ms)
    .execute(pool)
    .await?;

    Ok(())
}

pub(crate) async fn pull_changes_since(
    pool: &PgPool,
    user_id: Uuid,
    since_seq: i64,
) -> Result<(Vec<VocabularyItemDto>, Vec<FlashcardDto>, Vec<ReviewLogDto>), ApiError> {
    let vocab_rows = sqlx::query(
        r#"
        SELECT id, lemma, normalized_key, surface_forms, language, target_language,
               primary_translation, primary_definition, part_of_speech, meanings,
               occurrences, custom_examples, tags, status, version, created_at,
               updated_at, deleted_at
        FROM vocabulary_items
        WHERE user_id = $1 AND sync_seq > $2
        ORDER BY sync_seq ASC
        "#,
    )
    .bind(user_id)
    .bind(since_seq)
    .fetch_all(pool)
    .await?;

    let mut vocab_items = Vec::with_capacity(vocab_rows.len());
    for row in &vocab_rows {
        vocab_items.push(row_to_vocab_dto(row)?);
    }

    let card_rows = sqlx::query(
        r#"
        SELECT id, vocabulary_id, due, stability, difficulty, elapsed_days,
               scheduled_days, reps, lapses, state, last_review, version, updated_at
        FROM flashcards
        WHERE user_id = $1 AND sync_seq > $2
        ORDER BY sync_seq ASC
        "#,
    )
    .bind(user_id)
    .bind(since_seq)
    .fetch_all(pool)
    .await?;

    let mut cards = Vec::with_capacity(card_rows.len());
    for row in &card_rows {
        cards.push(FlashcardDto {
            id: row.try_get("id")?,
            vocabulary_id: row.try_get("vocabulary_id")?,
            due: row.try_get("due")?,
            stability: row.try_get("stability")?,
            difficulty: row.try_get("difficulty")?,
            elapsed_days: row.try_get("elapsed_days")?,
            scheduled_days: row.try_get("scheduled_days")?,
            reps: row.try_get("reps")?,
            lapses: row.try_get("lapses")?,
            state: row.try_get("state")?,
            last_review: row.try_get("last_review")?,
            version: row.try_get("version")?,
            updated_at: row.try_get("updated_at")?,
        });
    }

    let log_rows = sqlx::query(
        r#"
        SELECT id, flashcard_id, vocabulary_id, rating, state_before,
               stability_after, difficulty_after, elapsed_days, scheduled_days,
               reviewed_at, duration_ms
        FROM review_logs
        WHERE user_id = $1 AND sync_seq > $2
        ORDER BY sync_seq ASC
        "#,
    )
    .bind(user_id)
    .bind(since_seq)
    .fetch_all(pool)
    .await?;

    let mut logs = Vec::with_capacity(log_rows.len());
    for row in &log_rows {
        logs.push(ReviewLogDto {
            id: row.try_get("id")?,
            flashcard_id: row.try_get("flashcard_id")?,
            vocabulary_id: row.try_get("vocabulary_id")?,
            rating: row.try_get("rating")?,
            state_before: row.try_get("state_before")?,
            stability_after: row.try_get("stability_after")?,
            difficulty_after: row.try_get("difficulty_after")?,
            elapsed_days: row.try_get("elapsed_days")?,
            scheduled_days: row.try_get("scheduled_days")?,
            reviewed_at: row.try_get("reviewed_at")?,
            duration_ms: row.try_get("duration_ms")?,
        });
    }

    Ok((vocab_items, cards, logs))
}

fn row_to_vocab_dto(row: &sqlx::postgres::PgRow) -> Result<VocabularyItemDto, ApiError> {
    let surface_forms_val: serde_json::Value = row.try_get("surface_forms")?;
    let meanings_val: serde_json::Value = row.try_get("meanings")?;
    let occurrences_val: serde_json::Value = row.try_get("occurrences")?;
    let custom_examples_val: serde_json::Value = row.try_get("custom_examples")?;
    let tags_val: serde_json::Value = row.try_get("tags")?;

    Ok(VocabularyItemDto {
        id: row.try_get("id")?,
        lemma: row.try_get("lemma")?,
        normalized_key: row.try_get("normalized_key")?,
        surface_forms: serde_json::from_value(surface_forms_val).unwrap_or_default(),
        language: row.try_get("language")?,
        target_language: row.try_get("target_language")?,
        primary_translation: row.try_get("primary_translation")?,
        primary_definition: row.try_get("primary_definition")?,
        part_of_speech: row.try_get("part_of_speech")?,
        meanings: serde_json::from_value(meanings_val).unwrap_or_default(),
        occurrences: serde_json::from_value(occurrences_val).unwrap_or_default(),
        custom_examples: serde_json::from_value(custom_examples_val).unwrap_or_default(),
        tags: serde_json::from_value(tags_val).unwrap_or_default(),
        status: row.try_get("status")?,
        version: row.try_get("version")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        deleted_at: row.try_get("deleted_at")?,
    })
}
