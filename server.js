require('dotenv').config();
const app = require('./src/app');
const { pool, connectDB } = require('./src/config/db');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Verify database connection before starting the server
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    console.log('Shutting down server...');
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();
