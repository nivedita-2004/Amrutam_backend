require('dotenv').config();
const { pool } = require('../../src/config/db');
const logger = require('../../src/utils/logger');

/**
 * Repeatable Backfill Script for Doctor Records
 * 
 * Safely creates a pending doctor record for any user with role = 'doctor'
 * who does not already have a linked record in the doctors table.
 * 
 * Guarantees:
 * - Idempotent (safe to run multiple times).
 * - Does not overwrite or alter existing doctor profiles.
 * - Does not modify verification statuses of already verified/rejected doctors.
 * - Uses a PostgreSQL transaction to ensure all-or-nothing execution.
 */
async function backfillDoctorRecords() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Identify doctor users missing a doctor profile
    const findMissingSql = `
      SELECT u.id, u.name, u.email
      FROM users u
      LEFT JOIN doctors d ON u.id = d.user_id
      WHERE u.role = 'doctor' AND d.id IS NULL
      ORDER BY u.id ASC;
    `;
    const { rows: missingDoctors } = await client.query(findMissingSql);

    if (missingDoctors.length === 0) {
      console.log('✓ All doctor users already have corresponding doctor records. No backfill needed.');
      await client.query('COMMIT');
      return;
    }

    console.log(`Found ${missingDoctors.length} doctor account(s) without doctor records. Backfilling...`);

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

    for (const docUser of missingDoctors) {
      await client.query(insertDoctorSql, [
        docUser.id,
        'General Medicine',
        'Not Specified'
      ]);
      console.log(`  + Created pending doctor record for user ID ${docUser.id} (${docUser.email})`);
    }

    await client.query('COMMIT');
    console.log(`✓ Successfully backfilled ${missingDoctors.length} doctor record(s).`);
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('✗ Backfill failed, transaction rolled back:', err.message);
    throw err;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

if (require.main === module) {
  backfillDoctorRecords()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = backfillDoctorRecords;
