const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const connectDB = async () => {
  try {
    await pool.query('SELECT 1');
    console.log('Database connected successfully.');
  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exit(1);
  }
};

module.exports = { pool, connectDB };
