-- 007_create_idempotency_keys.sql
-- Migration 7: Request-level Idempotency for Consultations

BEGIN;

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation VARCHAR(100) NOT NULL,
    key VARCHAR(255) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'processing',
    response_code INT,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    CONSTRAINT chk_idempotency_status CHECK (
        status IN ('processing', 'completed', 'failed')
    ),
    CONSTRAINT uq_idempotency_user_op_key UNIQUE (user_id, operation, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys (user_id, operation, key);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);

COMMIT;
