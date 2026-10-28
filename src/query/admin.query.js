const { pool } = require('../config/db');

const getSystemMetrics = async () => {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM doctors WHERE verification_status = 'verified') AS active_doctors,
      (SELECT COUNT(*) FROM consultations) AS total_consultations,
      (SELECT COUNT(*) FROM consultations WHERE status = 'completed') AS completed_consultations;
  `;
  const res = await pool.query(sql);
  return res.rows[0];
};

const listPendingDoctorVerifications = async () => {
  const sql = `
    SELECT 
      d.id, d.user_id, u.name, u.email, d.specialization, 
      d.qualification, d.experience_years, d.consultation_fee, 
      d.verification_status, d.created_at, d.updated_at
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    WHERE d.verification_status = 'pending'
    ORDER BY d.created_at ASC;
  `;
  const res = await pool.query(sql);
  return res.rows;
};

const verifyDoctor = async (doctorId, status) => {
  const sql = `
    WITH updated AS (
      UPDATE doctors
      SET verification_status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, user_id, specialization, qualification, experience_years, consultation_fee, verification_status, updated_at
    )
    SELECT 
      up.id, up.user_id, u.name, u.email, up.specialization, 
      up.qualification, up.experience_years, up.consultation_fee, 
      up.verification_status, up.updated_at
    FROM updated up
    JOIN users u ON up.user_id = u.id;
  `;
  const res = await pool.query(sql, [status, doctorId]);
  return res.rows[0] || null;
};

module.exports = {
  getSystemMetrics,
  listPendingDoctorVerifications,
  verifyDoctor
};
