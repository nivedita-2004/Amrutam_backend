const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const requestIdMiddleware = require('./middleware/requestId.middleware');
const rateLimiter = require('./middleware/rateLimit.middleware');
const errorHandler = require('./middleware/error.middleware');
const { pool } = require('./config/db');

const authRoutes = require('./routes/auth.route');
const userRoutes = require('./routes/user.route');
const doctorRoutes = require('./routes/doctor.route');
const availabilityRoutes = require('./routes/availability.route');
const consultationRoutes = require('./routes/consultation.route');
const prescriptionRoutes = require('./routes/prescription.route');
const paymentRoutes = require('./routes/payment.route');
const adminRoutes = require('./routes/admin.route');

const app = express();

// Security middleware
app.use(helmet());

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
}));

// Request parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Request ID and HTTP logging
app.use(requestIdMiddleware);

app.use(pinoHttp({
  logger,
  genReqId: (req) => req.id,
  autoLogging: {
    ignore: (req) => req.path.startsWith('/health')
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode
      };
    }
  }
}));

// Health checks
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});

app.get('/health/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    return res.status(200).json({
      status: 'UP',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error({ err }, 'Database readiness check failed');

    return res.status(503).json({
      status: 'DOWN',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
});

// General API rate limiting
app.use('/api', rateLimiter.apiLimiter);

// API routes — no versioned endpoints
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    statusCode: 404,
    message: `Route not found: ${req.method} ${req.path}`,
    requestId: req.id
  });
});

// Centralized error handler
app.use(errorHandler);

module.exports = app;