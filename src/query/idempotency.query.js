const { pool } = require('../config/db');

/**
 * Retrieves an existing idempotency record for a given user, operation, and key.
 */
const getIdempotencyRecord = async (userId, operation, key, dbExecutor = pool) => {
  const sql = `
    SELECT id, user_id, operation, key, request_hash, status, response_code, response_body, created_at, updated_at, expires_at
    FROM idempotency_keys
    WHERE user_id = $1 AND operation = $2 AND key = $3;
  `;
  const res = await dbExecutor.query(sql, [userId, operation, key]);
  return res.rows[0] || null;
};

/**
 * Inserts a new idempotency key with 'processing' status.
 * Uses the active transaction client. If a concurrent transaction tries to insert
 * the same (user_id, operation, key), PostgreSQL's unique constraint will serialize/block
 * or throw error 23505 upon commit of the winner.
 */
const createProcessingRecord = async (client, { userId, operation, key, requestHash }) => {
  const sql = `
    INSERT INTO idempotency_keys (user_id, operation, key, request_hash, status)
    VALUES ($1, $2, $3, $4, 'processing')
    RETURNING id, user_id, operation, key, request_hash, status;
  `;
  const res = await client.query(sql, [userId, operation, key, requestHash]);
  return res.rows[0];
};

/**
 * Updates an idempotency record to 'completed' with the original HTTP status code and response body.
 * Executed within the same transaction client before COMMIT for atomic persistence.
 */
const completeIdempotencyRecord = async (client, { userId, operation, key, responseCode, responseBody }) => {
  const sql = `
    UPDATE idempotency_keys
    SET status = 'completed',
        response_code = $1,
        response_body = $2,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $3 AND operation = $4 AND key = $5
    RETURNING id, status, response_code, response_body;
  `;
  const res = await client.query(sql, [responseCode, JSON.stringify(responseBody), userId, operation, key]);
  return res.rows[0] || null;
};

module.exports = {
  getIdempotencyRecord,
  createProcessingRecord,
  completeIdempotencyRecord
};
