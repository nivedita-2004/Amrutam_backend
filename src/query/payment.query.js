const { pool } = require('../config/db');

/**
 * Upserts a payment record for a consultation.
 * Handles initial payment attempts as well as retries for failed attempts
 * while enforcing exactly one payment record per consultation.
 */
const upsertPaymentRecord = async ({ consultationId, amount, currency = 'INR', status = 'pending', providerReference }) => {
  const sql = `
    INSERT INTO payments (consultation_id, amount, currency, status, provider_reference)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (consultation_id) DO UPDATE SET
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      provider_reference = COALESCE(EXCLUDED.provider_reference, payments.provider_reference),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, consultation_id, amount, currency, status, provider_reference, created_at, updated_at;
  `;
  const res = await pool.query(sql, [consultationId, amount, currency, status, providerReference]);
  return res.rows[0];
};

const getPaymentById = async (id) => {
  const sql = `
    SELECT id, consultation_id, amount, currency, status, provider_reference, created_at, updated_at
    FROM payments
    WHERE id = $1;
  `;
  const res = await pool.query(sql, [id]);
  return res.rows[0] || null;
};

const getPaymentByConsultationId = async (consultationId) => {
  const sql = `
    SELECT id, consultation_id, amount, currency, status, provider_reference, created_at, updated_at
    FROM payments
    WHERE consultation_id = $1;
  `;
  const res = await pool.query(sql, [consultationId]);
  return res.rows[0] || null;
};

const updatePaymentStatus = async (id, status, providerReference) => {
  const sql = `
    UPDATE payments
    SET 
      status = $1,
      provider_reference = COALESCE($2, provider_reference),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING id, consultation_id, amount, currency, status, provider_reference, updated_at;
  `;
  const res = await pool.query(sql, [status, providerReference, id]);
  return res.rows[0] || null;
};

module.exports = {
  upsertPaymentRecord,
  getPaymentById,
  getPaymentByConsultationId,
  updatePaymentStatus
};
