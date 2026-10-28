const { pool } = require('../config/db');

const listDoctors = async ({ specialization, limit = 20, offset = 0 } = {}) => {
  const params = [];
  let whereClauses = ["d.verification_status = 'verified'"];

  if (specialization) {
    params.push(`%${specialization}%`);
    whereClauses.push(`d.specialization ILIKE $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const sql = `
    SELECT 
      d.id, d.user_id, u.name, u.email, d.specialization, 
      d.qualification, d.experience_years, d.consultation_fee, 
      d.verification_status, d.bio, d.created_at, d.updated_at
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY d.experience_years DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx};
  `;

  const res = await pool.query(sql, params);
  return res.rows;
};

const getDoctorById = async (doctorId) => {
  const sql = `
    SELECT 
      d.id, d.user_id, u.name, u.email, d.specialization, 
      d.qualification, d.experience_years, d.consultation_fee, 
      d.verification_status, d.bio, d.created_at, d.updated_at
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    WHERE d.id = $1;
  `;
  const res = await pool.query(sql, [doctorId]);
  return res.rows[0] || null;
};

const getDoctorByUserId = async (userId) => {
  const sql = `
    SELECT 
      d.id, d.user_id, u.name, u.email, d.specialization, 
      d.qualification, d.experience_years, d.consultation_fee, 
      d.verification_status, d.bio, d.created_at, d.updated_at
    FROM doctors d
    JOIN users u ON d.user_id = u.id
    WHERE d.user_id = $1;
  `;
  const res = await pool.query(sql, [userId]);
  return res.rows[0] || null;
};

const upsertDoctorProfile = async (userId, fields = {}) => {
  const existing = await getDoctorByUserId(userId);

  if (existing) {
    const sets = [];
    const params = [];

    if (fields.specialization !== undefined) {
      params.push(fields.specialization);
      sets.push(`specialization = $${params.length}`);
    }

    if (fields.qualification !== undefined) {
      params.push(fields.qualification);
      sets.push(`qualification = $${params.length}`);
    }

    if (fields.experience_years !== undefined) {
      params.push(fields.experience_years);
      sets.push(`experience_years = $${params.length}`);
    }

    if (fields.consultation_fee !== undefined) {
      params.push(fields.consultation_fee);
      sets.push(`consultation_fee = $${params.length}`);
    }

    if (fields.bio !== undefined) {
      params.push(fields.bio);
      sets.push(`bio = $${params.length}`);
    }

    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      params.push(userId);
      const sql = `
        UPDATE doctors
        SET ${sets.join(', ')}
        WHERE user_id = $${params.length};
      `;
      await pool.query(sql, params);
    }

    return await getDoctorByUserId(userId);
  }

  // If no doctor record exists yet, create one
  const insertSql = `
    INSERT INTO doctors (
      user_id,
      specialization,
      qualification,
      experience_years,
      consultation_fee,
      bio,
      verification_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'pending')
    RETURNING id;
  `;
  await pool.query(insertSql, [
    userId,
    fields.specialization || 'General Medicine',
    fields.qualification || 'Not Specified',
    fields.experience_years !== undefined ? fields.experience_years : 0,
    fields.consultation_fee !== undefined ? fields.consultation_fee : 0,
    fields.bio || null
  ]);

  return await getDoctorByUserId(userId);
};

module.exports = {
  listDoctors,
  getDoctorById,
  getDoctorByUserId,
  upsertDoctorProfile
};
