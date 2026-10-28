const { pool } = require('../config/db');

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authorization',
  'cookie',
  'credentials',
  'otp',
  'cvv',
  'apikey'
]);

/**
 * Recursively sanitizes audit metadata, redacting any sensitive secrets or credentials.
 */
const sanitizeMetadata = (obj, depth = 0) => {
  if (!obj || typeof obj !== 'object' || depth > 5) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeMetadata(item, depth + 1));
  }
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || SENSITIVE_KEYS.has(key)) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeMetadata(value, depth + 1);
    } else if (typeof value === 'string' && value.length > 500) {
      clean[key] = value.slice(0, 500) + '...[TRUNCATED]';
    } else {
      clean[key] = value;
    }
  }
  return clean;
};

/**
 * Persists an audit log entry in PostgreSQL using parameterized queries.
 * Supports optional transactional client for atomic operations.
 */
const createAuditLog = async (
  { actorUserId, action, entityType, entityId, requestId, metadata = {} },
  client = pool
) => {
  const sanitized = sanitizeMetadata(metadata);
  const sql = `
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, request_id, metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, actor_user_id, action, entity_type, entity_id, request_id, timestamp, metadata;
  `;
  const res = await client.query(sql, [
    actorUserId || null,
    action,
    entityType,
    entityId || null,
    requestId || null,
    JSON.stringify(sanitized)
  ]);
  return res.rows[0];
};

/**
 * Safe operational audit logger.
 * For atomic state changes (when a client connection is provided), rethrows errors to roll back.
 * For ordinary operational events (using the pool), logs a warning instead of failing the request.
 */
const recordAuditLog = async (params, client = pool) => {
  if (client !== pool) {
    return await createAuditLog(params, client);
  }
  try {
    return await createAuditLog(params, pool);
  } catch (err) {
    const logger = require('../utils/logger');
    logger.warn({ err: err.message, action: params.action }, 'Failed to record operational audit log');
    return null;
  }
};

const listAuditLogs = async ({ actorUserId, entityType, entityId, action, limit = 50, offset = 0 } = {}) => {
  const params = [];
  const whereClauses = [];

  if (actorUserId) {
    params.push(actorUserId);
    whereClauses.push(`actor_user_id = $${params.length}`);
  }
  if (entityType) {
    params.push(entityType);
    whereClauses.push(`entity_type = $${params.length}`);
  }
  if (entityId) {
    params.push(entityId);
    whereClauses.push(`entity_id = $${params.length}`);
  }
  if (action) {
    params.push(action);
    whereClauses.push(`action = $${params.length}`);
  }

  const wherePart = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const sql = `
    SELECT id, actor_user_id, action, entity_type, entity_id, request_id, timestamp, metadata
    FROM audit_logs
    ${wherePart}
    ORDER BY timestamp DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx};
  `;

  const res = await pool.query(sql, params);
  return res.rows;
};

module.exports = {
  createAuditLog,
  recordAuditLog,
  listAuditLogs,
  sanitizeMetadata
};
