const { pool } = require('../config/db');

const getUserProfile = async (userId) => {
  const sql = `
    SELECT 
      u.id, 
      u.name, 
      u.email, 
      u.role, 
      u.status, 
      u.created_at,
      u.updated_at,
      p.phone, 
      TO_CHAR(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, 
      p.gender, 
      p.address, 
      p.emergency_contact
    FROM users u
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE u.id = $1;
  `;
  const res = await pool.query(sql, [userId]);
  return res.rows[0] || null;
};

const upsertUserProfile = async (userId, fields = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update users table if name or email provided
    const userSets = [];
    const userParams = [];

    if (fields.name !== undefined) {
      userParams.push(fields.name.trim());
      userSets.push(`name = $${userParams.length}`);
    }

    if (fields.email !== undefined) {
      userParams.push(fields.email.toLowerCase().trim());
      userSets.push(`email = LOWER($${userParams.length})`);
    }

    if (userSets.length > 0) {
      userSets.push('updated_at = CURRENT_TIMESTAMP');
      userParams.push(userId);
      const userSql = `
        UPDATE users 
        SET ${userSets.join(', ')} 
        WHERE id = $${userParams.length};
      `;
      await client.query(userSql, userParams);
    }

    // 2. Ensure profile row exists
    await client.query(
      `INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;`,
      [userId]
    );

    // 3. Update profiles table if profile fields provided
    const profileSets = [];
    const profileParams = [];

    if (fields.phone !== undefined) {
      profileParams.push(fields.phone);
      profileSets.push(`phone = $${profileParams.length}`);
    }

    if (fields.date_of_birth !== undefined) {
      profileParams.push(fields.date_of_birth);
      profileSets.push(`date_of_birth = $${profileParams.length}`);
    }

    if (fields.gender !== undefined) {
      profileParams.push(fields.gender);
      profileSets.push(`gender = $${profileParams.length}`);
    }

    if (fields.address !== undefined) {
      profileParams.push(fields.address);
      profileSets.push(`address = $${profileParams.length}`);
    }

    if (fields.emergency_contact !== undefined) {
      profileParams.push(fields.emergency_contact);
      profileSets.push(`emergency_contact = $${profileParams.length}`);
    }

    if (profileSets.length > 0) {
      profileSets.push('updated_at = CURRENT_TIMESTAMP');
      profileParams.push(userId);
      const profileSql = `
        UPDATE profiles 
        SET ${profileSets.join(', ')} 
        WHERE user_id = $${profileParams.length};
      `;
      await client.query(profileSql, profileParams);
    }

    // 4. Retrieve complete updated profile
    const selectSql = `
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role, 
        u.status, 
        u.created_at,
        u.updated_at,
        p.phone, 
        TO_CHAR(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, 
        p.gender, 
        p.address, 
        p.emergency_contact
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      WHERE u.id = $1;
    `;
    const updatedRes = await client.query(selectSql, [userId]);

    await client.query('COMMIT');
    return updatedRes.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getUserProfile,
  upsertUserProfile
};
