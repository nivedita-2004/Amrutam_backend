require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const ADVISORY_LOCK_KEY = "hashtext('amrutam_telemedicine_migrations')";

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    logger.error('Cannot run migrations: DATABASE_URL is not set in environment.');
    console.error('Error: DATABASE_URL is not defined in .env');
    process.exit(1);
  }

  let client;
  try {
    client = await pool.connect();
    logger.info('Acquiring database advisory lock for migrations...');
    await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);

    // Ensure schema migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Fetch applied migrations
    const { rows: appliedRows } = await client.query(
      'SELECT name FROM schema_migrations ORDER BY id ASC;'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    // Read and sort available migration files
    const allFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const pendingMigrations = allFiles.filter((file) => !appliedSet.has(file));

    if (pendingMigrations.length === 0) {
      console.log('✓ Database schema is up to date. No pending migrations.');
      logger.info('Database schema is up to date. No pending migrations.');
      return;
    }

    console.log(`Found ${pendingMigrations.length} pending migration(s) to apply.`);
    logger.info({ count: pendingMigrations.length }, 'Applying pending migrations');

    for (const migrationName of pendingMigrations) {
      const filePath = path.join(MIGRATIONS_DIR, migrationName);
      const sqlContent = fs.readFileSync(filePath, 'utf8');

      console.log(`Applying: ${migrationName}...`);
      logger.info({ migration: migrationName }, 'Executing migration');

      try {
        await client.query('BEGIN');
        await client.query(sqlContent);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1);',
          [migrationName]
        );
        await client.query('COMMIT');
        console.log(`✓ Applied successfully: ${migrationName}`);
        logger.info({ migration: migrationName }, 'Migration applied successfully');
      } catch (migrationErr) {
        await client.query('ROLLBACK');
        console.error(`✗ FAILED migration: ${migrationName}`);
        console.error(`Error details: ${migrationErr.message}`);
        logger.error({ migration: migrationName, err: migrationErr.message }, 'Migration execution failed');
        throw migrationErr;
      }
    }

    console.log('✓ All pending migrations applied successfully.');
  } catch (err) {
    console.error('Migration runner failed:', err.message);
    process.exit(1);
  } finally {
    if (client) {
      try {
        await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
      } catch (unlockErr) {
        logger.error({ err: unlockErr.message }, 'Failed to release advisory lock');
      }
      client.release();
    }
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;
