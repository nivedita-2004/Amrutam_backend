require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

async function runSeed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run seed script in production environment.');
    process.exit(1);
  }

  const seedFile = path.join(__dirname, 'seeds', '001_seed_dev_data.sql');
  if (!fs.existsSync(seedFile)) {
    console.log('No seed files found.');
    return;
  }

  const client = await pool.connect();
  try {
    console.log('Seeding development data...');
    const sql = fs.readFileSync(seedFile, 'utf8');
    await client.query(sql);
    console.log('✓ Development seed applied successfully.');
    logger.info('Development seed data inserted successfully.');
  } catch (err) {
    console.error('Seed error:', err.message);
    logger.error({ err: err.message }, 'Failed applying development seed');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = runSeed;
