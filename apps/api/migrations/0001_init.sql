CREATE SEQUENCE IF NOT EXISTS sync_global_seq START 1;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS vocabulary_items (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  lemma TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  surface_forms JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  primary_translation TEXT NOT NULL,
  primary_definition TEXT NOT NULL DEFAULT '',
  part_of_speech TEXT NOT NULL,
  meanings JSONB NOT NULL DEFAULT '[]'::jsonb,
  occurrences JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'new',
  version INT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  sync_seq BIGINT NOT NULL DEFAULT nextval('sync_global_seq'),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_user_seq ON vocabulary_items(user_id, sync_seq);
CREATE INDEX IF NOT EXISTS idx_vocabulary_user_norm ON vocabulary_items(user_id, normalized_key);

CREATE TABLE IF NOT EXISTS flashcards (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  vocabulary_id UUID NOT NULL,
  due TEXT NOT NULL,
  stability DOUBLE PRECISION NOT NULL,
  difficulty DOUBLE PRECISION NOT NULL,
  elapsed_days DOUBLE PRECISION NOT NULL,
  scheduled_days DOUBLE PRECISION NOT NULL,
  reps INT NOT NULL,
  lapses INT NOT NULL,
  state INT NOT NULL,
  last_review TEXT,
  version INT NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  sync_seq BIGINT NOT NULL DEFAULT nextval('sync_global_seq'),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_flashcards_user_seq ON flashcards(user_id, sync_seq);

CREATE TABLE IF NOT EXISTS review_logs (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  flashcard_id UUID NOT NULL,
  vocabulary_id UUID NOT NULL,
  rating TEXT NOT NULL,
  state_before INT NOT NULL,
  stability_after DOUBLE PRECISION NOT NULL,
  difficulty_after DOUBLE PRECISION NOT NULL,
  elapsed_days DOUBLE PRECISION NOT NULL,
  scheduled_days DOUBLE PRECISION NOT NULL,
  reviewed_at TEXT NOT NULL,
  duration_ms INT NOT NULL DEFAULT 0,
  sync_seq BIGINT NOT NULL DEFAULT nextval('sync_global_seq'),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_review_logs_user_seq ON review_logs(user_id, sync_seq);
