const { pool } = require('../config/db');

/**
 * Inserts a new refresh token record into PostgreSQL.
 * Parameterized queries protect against SQL injection.
 */
const createRefreshTokenRecord = async (
  { userId, familyId, tokenHash, expiresAt },
  client = pool
) => {
  const sql = `
    INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
    VALUES ($1, $2, $3, $4)
    RETURNING id, user_id, family_id, token_hash, is_revoked, expires_at, created_at;
  `;
  const res = await client.query(sql, [userId, familyId, tokenHash, expiresAt]);
  return res.rows[0];
};

/**
 * Finds a refresh token by its SHA-256 hash with row-level locking for update.
 * MUST be executed inside a database transaction to prevent concurrent rotation races.
 */
const findTokenByHashForUpdate = async (tokenHash, client) => {
  const sql = `
    SELECT id, user_id, family_id, token_hash, replaced_by_hash, is_revoked, revoked_at, expires_at, created_at
    FROM refresh_tokens
    WHERE token_hash = $1
    FOR UPDATE;
  `;
  const res = await client.query(sql, [tokenHash]);
  return res.rows[0] || null;
};

/**
 * Marks an existing token as revoked and links it to the replacement token hash.
 */
const rotateTokenRecord = async (oldTokenId, replacementHash, client) => {
  const sql = `
    UPDATE refresh_tokens
    SET is_revoked = true,
        revoked_at = CURRENT_TIMESTAMP,
        replaced_by_hash = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, family_id, is_revoked;
  `;
  const res = await client.query(sql, [replacementHash, oldTokenId]);
  return res.rows[0] || null;
};

/**
 * Revokes all tokens in a family upon detecting token reuse.
 */
const revokeFamily = async (familyId, client = pool) => {
  const sql = `
    UPDATE refresh_tokens
    SET is_revoked = true,
        revoked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE family_id = $1 AND is_revoked = false
    RETURNING id;
  `;
  const res = await client.query(sql, [familyId]);
  return res.rows;
};

/**
 * Revokes a specific token by hash (used on user logout).
 */
const revokeTokenByHash = async (tokenHash, client = pool) => {
  const sql = `
    UPDATE refresh_tokens
    SET is_revoked = true,
        revoked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE token_hash = $1 AND is_revoked = false
    RETURNING id, family_id;
  `;
  const res = await client.query(sql, [tokenHash]);
  return res.rows[0] || null;
};

/**
 * Revokes all active refresh tokens belonging to a user (used on account suspension or password change).
 */
const revokeUserTokens = async (userId, client = pool) => {
  const sql = `
    UPDATE refresh_tokens
    SET is_revoked = true,
        revoked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND is_revoked = false
    RETURNING id;
  `;
  const res = await client.query(sql, [userId]);
  return res.rows;
};

module.exports = {
  createRefreshTokenRecord,
  findTokenByHashForUpdate,
  rotateTokenRecord,
  revokeFamily,
  revokeTokenByHash,
  revokeUserTokens
};
