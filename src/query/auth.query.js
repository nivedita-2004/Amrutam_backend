const { pool } = require('../config/db');

/**
 * Finds user by email address (case-insensitive)
 * Includes password_hash for credential verification in login flow
 */
const findUserByEmail = async (email) => {
  const sql = `
    SELECT id, name, email, password_hash, role, status, created_at
    FROM users
    WHERE LOWER(email) = LOWER($1);
  `;
  const res = await pool.query(sql, [email]);
  return res.rows[0] || null;
};

/**
 * Creates a new user record and initializes a linked profile
 * Uses parameterized SQL queries
 */
const createUser = async ({ name, email, passwordHash, role = 'patient', specialization, qualification }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertUserSql = `
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, LOWER($2), $3, $4)
      RETURNING id, name, email, role, status, created_at;
    `;
    const userResult = await client.query(insertUserSql, [name, email, passwordHash, role]);
    const newUser = userResult.rows[0];

    // Initialize an empty profile for the newly registered user
    const insertProfileSql = `
      INSERT INTO profiles (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING;
    `;
    await client.query(insertProfileSql, [newUser.id]);

    // Automatically initialize doctor record if registering with doctor role
    if (newUser.role === 'doctor') {
      const docSpecialization = (specialization && specialization.trim()) || 'General Medicine';
      const docQualification = (qualification && qualification.trim()) || 'Not Specified';

      const insertDoctorSql = `
        INSERT INTO doctors (
          user_id,
          specialization,
          qualification,
          experience_years,
          consultation_fee,
          verification_status
        )
        VALUES ($1, $2, $3, DEFAULT, DEFAULT, 'pending')
        ON CONFLICT (user_id) DO NOTHING;
      `;
      await client.query(insertDoctorSql, [
        newUser.id,
        docSpecialization,
        docQualification
      ]);
    }

    await client.query('COMMIT');
    return newUser;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Finds user and profile details by user ID
 * Never selects or returns password_hash
 */
const findUserWithProfileById = async (id) => {
  const sql = `
    SELECT 
      u.id, u.name, u.email, u.role, u.status, u.created_at, u.updated_at,
      p.phone, p.date_of_birth, p.gender, p.address, p.emergency_contact
    FROM users u
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE u.id = $1;
  `;
  const res = await pool.query(sql, [id]);
  return res.rows[0] || null;
};

/**
 * Finds basic user details by ID
 */
const findUserById = async (id) => {
  const sql = `
    SELECT id, name, email, role, status, created_at
    FROM users
    WHERE id = $1;
  `;
  const res = await pool.query(sql, [id]);
  return res.rows[0] || null;
};

module.exports = {
  findUserByEmail,
  createUser,
  findUserWithProfileById,
  findUserById
};
