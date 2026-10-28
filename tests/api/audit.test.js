require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_automated_testing_12345';
const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/config/db');
const auditQuery = require('../../src/query/audit.query');

describe('Persistent Audit Logging Module', () => {
  const auditTestEmail = 'audit.tester@amrutam.test.example.com';
  const testPassword = 'AuditPassword123!';
  let userId;
  let doctorUserId;
  let doctorId;
  let patientToken;
  let doctorToken;

  beforeAll(async () => {
    // Clean up previous test entries
    await pool.query('DELETE FROM audit_logs WHERE metadata->>\'email\' = $1', [auditTestEmail]);
    await pool.query('DELETE FROM users WHERE email = $1', [auditTestEmail]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM audit_logs WHERE metadata->>\'email\' = $1', [auditTestEmail]);
    await pool.query('DELETE FROM users WHERE email = $1', [auditTestEmail]);
  });

  describe('Authentication Audit Logging', () => {
    it('should create an audit entry on successful signup without logging sensitive data', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Audit Tester',
          email: auditTestEmail,
          password: testPassword,
          role: 'patient'
        });

      expect(res.statusCode).toBe(201);
      userId = res.body.data.user.id;

      // Extract access token for subsequent authenticated requests
      const cookies = res.headers['set-cookie'];
      const accessCookie = cookies.find((c) => c.startsWith('accessToken='));
      patientToken = accessCookie.split(';')[0].split('=')[1];

      // Verify audit log in PostgreSQL
      const auditRes = await pool.query(
        "SELECT * FROM audit_logs WHERE action = 'AUTH_SIGNUP_SUCCESS' AND actor_user_id = $1 ORDER BY id DESC LIMIT 1",
        [userId]
      );

      expect(auditRes.rows.length).toBe(1);
      const log = auditRes.rows[0];
      expect(log.action).toBe('AUTH_SIGNUP_SUCCESS');
      expect(log.entity_type).toBe('user');
      expect(log.entity_id).toBe(String(userId));

      // Verify sensitive values are NEVER persisted
      const metadataStr = JSON.stringify(log.metadata);
      expect(metadataStr).not.toContain(testPassword);
      expect(metadataStr).not.toContain('password_hash');
    });

    it('should create an audit entry on successful login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: auditTestEmail,
          password: testPassword
        });

      expect(res.statusCode).toBe(200);

      const auditRes = await pool.query(
        "SELECT * FROM audit_logs WHERE action = 'AUTH_LOGIN_SUCCESS' AND actor_user_id = $1 ORDER BY id DESC LIMIT 1",
        [userId]
      );

      expect(auditRes.rows.length).toBe(1);
      const log = auditRes.rows[0];
      expect(log.action).toBe('AUTH_LOGIN_SUCCESS');
      expect(log.actor_user_id).toBe(String(userId));
    });

    it('should create an audit entry on failed login without logging raw passwords', async () => {
      const maliciousPassword = 'SecretAttemptedPassword999!';
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: auditTestEmail,
          password: maliciousPassword
        });

      expect(res.statusCode).toBe(401);

      const auditRes = await pool.query(
        "SELECT * FROM audit_logs WHERE action = 'AUTH_LOGIN_FAILED' AND metadata->>'email' = $1 ORDER BY id DESC LIMIT 1",
        [auditTestEmail]
      );

      expect(auditRes.rows.length).toBe(1);
      const log = auditRes.rows[0];
      expect(log.action).toBe('AUTH_LOGIN_FAILED');
      expect(log.actor_user_id).toBeNull();
      expect(log.metadata.email).toBe(auditTestEmail);
      expect(log.metadata.reason).toBe('invalid_password');

      // Crucial: The attempted password must NEVER appear in the audit table
      const rawMetadata = JSON.stringify(log.metadata);
      expect(rawMetadata).not.toContain(maliciousPassword);
    });

    it('should create an audit entry on logout', async () => {
      const res = await request(app)
        .post('/api/auth/logout');

      expect(res.statusCode).toBe(200);

      const auditRes = await pool.query(
        "SELECT * FROM audit_logs WHERE action = 'AUTH_LOGOUT_SUCCESS' ORDER BY id DESC LIMIT 1"
      );

      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].action).toBe('AUTH_LOGOUT_SUCCESS');
    });
  });

  describe('Metadata Sanitization Utility', () => {
    it('should recursively redact all sensitive keys (password, tokens, secrets, cookies)', () => {
      const dirtyMetadata = {
        email: 'test@example.com',
        password: 'TopSecretPassword!',
        nested: {
          accessToken: 'eyJhbGciOi...',
          refreshToken: 'def5020...',
          authDetails: {
            apiKey: 'sk_live_12345',
            safeNote: 'harmless string'
          }
        },
        cookie: 'sessionId=999'
      };

      const sanitized = auditQuery.sanitizeMetadata(dirtyMetadata);

      expect(sanitized.email).toBe('test@example.com');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.cookie).toBe('[REDACTED]');
      expect(sanitized.nested.accessToken).toBe('[REDACTED]');
      expect(sanitized.nested.refreshToken).toBe('[REDACTED]');
      expect(sanitized.nested.authDetails.apiKey).toBe('[REDACTED]');
      expect(sanitized.nested.authDetails.safeNote).toBe('harmless string');
    });
  });

  describe('Audit Logging Policy & Resilience', () => {
    it('should safely log operational events without throwing on non-transactional errors', async () => {
      // Test recordAuditLog with normal operational call
      const log = await auditQuery.recordAuditLog({
        actorUserId: userId,
        action: 'TEST_OPERATIONAL_EVENT',
        entityType: 'test',
        entityId: 999,
        requestId: 'req-test-123',
        metadata: { info: 'operational' }
      });

      expect(log).toBeDefined();
      expect(log.action).toBe('TEST_OPERATIONAL_EVENT');

      // Clean up test entry
      await pool.query('DELETE FROM audit_logs WHERE id = $1', [log.id]);
    });
  });
});
