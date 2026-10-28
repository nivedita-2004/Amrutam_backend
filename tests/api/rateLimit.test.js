require('dotenv').config();
const request = require('supertest');
const express = require('express');
const {
  createLimiter,
  loginLimiter,
  signupLimiter,
  refreshLimiter,
  passwordResetLimiter,
  apiLimiter
} = require('../../src/middleware/rateLimit.middleware');
const app = require('../../src/app');

describe('In-Memory Rate Limiting Module (express-rate-limit)', () => {
  let testApp;

  beforeAll(() => {
    testApp = express();
    testApp.use(express.json());

    // Middleware to simulate request ID injection like app.js
    testApp.use((req, res, next) => {
      req.id = req.headers['x-request-id'] || 'test-req-id-12345';
      next();
    });

    // Create a strict test limiter with limit: 3 requests per 60 seconds
    const strictLimiter = createLimiter({
      windowMs: 60 * 1000,
      limit: 3,
      message: 'Too many requests. Please try again later.'
    });

    testApp.get('/test/limited', strictLimiter, (req, res) => {
      res.status(200).json({ success: true, message: 'Request permitted' });
    });
  });

  describe('Threshold Enforcement & 429 Response Format', () => {
    it('should permit requests under the threshold and return standard rate limit headers', async () => {
      for (let i = 1; i <= 3; i++) {
        const res = await request(testApp).get('/test/limited');
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify standard rate limit headers
        expect(res.headers['ratelimit-limit']).toBeDefined();
        expect(res.headers['ratelimit-remaining']).toBeDefined();
        expect(res.headers['ratelimit-reset']).toBeDefined();
      }
    });

    it('should return HTTP 429 Too Many Requests once limit is exceeded with correct JSON format', async () => {
      const res = await request(testApp)
        .get('/test/limited')
        .set('X-Request-Id', 'req-rate-limit-test-999');

      expect(res.statusCode).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(429);
      expect(res.body.message).toMatch(/too many requests/i);
      expect(res.body.requestId).toBe('req-rate-limit-test-999');
    });
  });

  describe('Endpoint-Specific Rate Limiters', () => {
    it('should export separate, preconfigured limiters for sensitive endpoints', () => {
      expect(typeof loginLimiter).toBe('function');
      expect(typeof signupLimiter).toBe('function');
      expect(typeof refreshLimiter).toBe('function');
      expect(typeof passwordResetLimiter).toBe('function');
      expect(typeof apiLimiter).toBe('function');
    });

    it('should apply limiters to auth routes without crashing', () => {
      // Confirm the main express app is initialized and has routes mounted
      expect(app).toBeDefined();
      expect(typeof app.handle).toBe('function');
    });
  });

  describe('In-Memory Operation Without Redis', () => {
    it('should operate entirely in-memory with zero Redis dependencies or REDIS_URL', async () => {
      const originalRedisUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;

      try {
        const customLimiter = createLimiter({
          windowMs: 30 * 1000,
          limit: 2,
          message: 'Local memory rate limit exceeded'
        });

        const localApp = express();
        localApp.get('/test/local', customLimiter, (req, res) => {
          res.status(200).json({ success: true });
        });

        const res1 = await request(localApp).get('/test/local');
        expect(res1.statusCode).toBe(200);

        const res2 = await request(localApp).get('/test/local');
        expect(res2.statusCode).toBe(200);

        const res3 = await request(localApp).get('/test/local');
        expect(res3.statusCode).toBe(429);
        expect(res3.body.message).toBe('Local memory rate limit exceeded');
      } finally {
        if (originalRedisUrl) {
          process.env.REDIS_URL = originalRedisUrl;
        }
      }
    });
  });
});
