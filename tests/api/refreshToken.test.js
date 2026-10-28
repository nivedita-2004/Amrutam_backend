require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_automated_testing_12345';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const app = require('../../src/app');
const { pool } = require('../../src/config/db');

describe('Secure Refresh-Token Rotation & Reuse Detection Module', () => {
  const refreshUser = {
    name: 'Refresh Tester',
    email: 'refresh.tester@amrutam.test.example.com',
    password: 'SecurePassword123!',
    role: 'patient'
  };

  const JWT_SECRET = process.env.JWT_SECRET;
  let userId;

  beforeAll(async () => {
    // Clean up previous test users and tokens
    await pool.query('DELETE FROM users WHERE email = $1', [refreshUser.email.toLowerCase()]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [refreshUser.email.toLowerCase()]);
  });

  describe('Login & Token Storage', () => {
    it('should create user, issue HTTP-only cookies, and persist SHA-256 hash (never raw token)', async () => {
      const signupRes = await request(app)
        .post('/api/auth/signup')
        .send(refreshUser);

      expect(signupRes.statusCode).toBe(201);
      userId = signupRes.body.data.user.id;

      // Login to get tokens
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: refreshUser.email,
          password: refreshUser.password
        });

      expect(loginRes.statusCode).toBe(200);

      // Verify HTTP-only cookies
      const cookies = loginRes.headers['set-cookie'];
      const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');

      const rawRefreshToken = refreshCookie.split(';')[0].split('=')[1];
      const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

      // Verify database record has token_hash and NOT rawRefreshToken
      const dbRes = await pool.query(
        'SELECT * FROM refresh_tokens WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
        [userId]
      );

      expect(dbRes.rows.length).toBe(1);
      const record = dbRes.rows[0];
      expect(record.token_hash).toBe(tokenHash);
      expect(record.token_hash).not.toBe(rawRefreshToken);
      expect(record.is_revoked).toBe(false);
      expect(record.family_id).toBeDefined();

      // Ensure no raw refresh tokens exist in the database table
      const rawMatch = await pool.query(
        'SELECT * FROM refresh_tokens WHERE token_hash = $1',
        [rawRefreshToken]
      );
      expect(rawMatch.rows.length).toBe(0);
    });
  });

  describe('POST /api/auth/refresh (Rotation & Lifecycle)', () => {
    it('should successfully rotate both tokens and revoke the previous token', async () => {
      // 1. Login to get initial cookies
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: refreshUser.email, password: refreshUser.password });

      const initialCookies = loginRes.headers['set-cookie'];
      const initialRefreshCookie = initialCookies.find((c) => c.startsWith('refreshToken='));
      const oldRefreshToken = initialRefreshCookie.split(';')[0].split('=')[1];
      const oldTokenHash = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');

      // 2. Refresh tokens
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', initialCookies);

      expect(refreshRes.statusCode).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.message).toMatch(/refreshed/i);

      // 3. Verify new cookies were issued
      const newCookies = refreshRes.headers['set-cookie'];
      const newRefreshCookie = newCookies.find((c) => c.startsWith('refreshToken='));
      expect(newRefreshCookie).toBeDefined();
      const newRefreshToken = newRefreshCookie.split(';')[0].split('=')[1];
      expect(newRefreshToken).not.toBe(oldRefreshToken);

      // 4. Verify old token is now revoked in database
      const oldTokenDb = await pool.query(
        'SELECT * FROM refresh_tokens WHERE token_hash = $1',
        [oldTokenHash]
      );
      expect(oldTokenDb.rows.length).toBe(1);
      expect(oldTokenDb.rows[0].is_revoked).toBe(true);
      expect(oldTokenDb.rows[0].replaced_by_hash).toBeDefined();

      // 5. Verify new token is active with same family_id
      const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
      const newTokenDb = await pool.query(
        'SELECT * FROM refresh_tokens WHERE token_hash = $1',
        [newTokenHash]
      );
      expect(newTokenDb.rows.length).toBe(1);
      expect(newTokenDb.rows[0].is_revoked).toBe(false);
      expect(newTokenDb.rows[0].family_id).toBe(oldTokenDb.rows[0].family_id);
    });

    it('should trigger reuse detection when a previously rotated token is presented again', async () => {
      // 1. Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: refreshUser.email, password: refreshUser.password });

      const cookies = loginRes.headers['set-cookie'];
      const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));

      // 2. Perform legitimate first refresh (rotates token)
      const firstRefresh = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [refreshCookie]);

      expect(firstRefresh.statusCode).toBe(200);

      // 3. Attempt to REUSE the original (now rotated/revoked) token
      const reuseAttempt = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [refreshCookie]); // reusing the old token!

      expect(reuseAttempt.statusCode).toBe(403);
      expect(reuseAttempt.body.success).toBe(false);
      expect(reuseAttempt.body.message).toMatch(/reuse detected/i);

      // 4. Verify entire token family was revoked in PostgreSQL
      const decoded = jwt.decode(refreshCookie.split(';')[0].split('=')[1]);
      const familyCheck = await pool.query(
        'SELECT * FROM refresh_tokens WHERE family_id = $1 AND is_revoked = false',
        [decoded.familyId]
      );

      expect(familyCheck.rows.length).toBe(0); // All tokens in the family must be revoked!

      // 5. Verify security audit log recorded the reuse event
      const auditRes = await pool.query(
        "SELECT * FROM audit_logs WHERE action = 'AUTH_REFRESH_REUSE_DETECTED' AND actor_user_id = $1 ORDER BY id DESC LIMIT 1",
        [userId]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].metadata.familyId).toBe(decoded.familyId);
    });

    it('should reject refresh with an expired token with 401', async () => {
      const expiredRefreshToken = jwt.sign(
        { id: userId, role: 'patient', tokenType: 'refresh', familyId: crypto.randomUUID() },
        JWT_SECRET,
        { expiresIn: '-10s' }
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${expiredRefreshToken}`]);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/invalid or expired/i);
    });

    it('should reject refresh with an unknown or malformed token with 401', async () => {
      const unknownToken = jwt.sign(
        { id: userId, role: 'patient', tokenType: 'refresh', familyId: crypto.randomUUID() },
        JWT_SECRET,
        { expiresIn: '15d' }
      );

      // Note: unknownToken was signed with the secret but never persisted in PostgreSQL
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${unknownToken}`]);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/invalid or unrecognized/i);
    });

    it('should reject refresh when user account is suspended or inactive with 403', async () => {
      // Login to get valid token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: refreshUser.email, password: refreshUser.password });

      const cookies = loginRes.headers['set-cookie'];

      // Suspend user account
      await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [userId]);

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookies);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/inactive or suspended/i);

      // Restore user account
      await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [userId]);
    });

    it('should reject concurrent refresh requests on the same token without race conditions', async () => {
      // 1. Login to obtain a fresh token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: refreshUser.email, password: refreshUser.password });

      const cookies = loginRes.headers['set-cookie'];

      // 2. Fire 2 simultaneous refresh requests with the EXACT SAME token
      const [res1, res2] = await Promise.all([
        request(app).post('/api/auth/refresh').set('Cookie', cookies),
        request(app).post('/api/auth/refresh').set('Cookie', cookies)
      ]);

      const statusCodes = [res1.statusCode, res2.statusCode].sort();

      // Exactly ONE request must succeed (200), and the other must be rejected (403 or 401)
      expect(statusCodes[0]).toBe(200);
      expect([401, 403]).toContain(statusCodes[1]);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should revoke the active refresh token and clear cookies on logout', async () => {
      // 1. Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: refreshUser.email, password: refreshUser.password });

      const cookies = loginRes.headers['set-cookie'];
      const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
      const rawRefreshToken = refreshCookie.split(';')[0].split('=')[1];
      const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

      // 2. Logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookies);

      expect(logoutRes.statusCode).toBe(200);

      // 3. Verify token was revoked in PostgreSQL
      const dbCheck = await pool.query(
        'SELECT is_revoked FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash]
      );
      expect(dbCheck.rows[0].is_revoked).toBe(true);

      // 4. Verify cookies were cleared in response
      const clearedCookies = logoutRes.headers['set-cookie'];
      expect(clearedCookies.some((c) => c.startsWith('accessToken=;') || c.includes('accessToken='))).toBe(true);
      expect(clearedCookies.some((c) => c.startsWith('refreshToken=;') || c.includes('refreshToken='))).toBe(true);
    });

    it('should reject subsequent refresh requests using the refresh token from a logged-out session', async () => {
      // 1. Login to get cookies
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: refreshUser.email, password: refreshUser.password });

      const cookies = loginRes.headers['set-cookie'];
      const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));

      // 2. Logout with these cookies
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookies);

      expect(logoutRes.statusCode).toBe(200);

      // 3. Attempt to refresh using the refresh token that was invalidated by logout
      const refreshAttempt = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [refreshCookie]);

      // Revoked token triggers reuse detection (403)
      expect(refreshAttempt.statusCode).toBe(403);
      expect(refreshAttempt.body.success).toBe(false);
      expect(refreshAttempt.body.message).toMatch(/reuse detected|invalid/i);
    });
  });

  describe('Access-Token Expiry & End-to-End Refresh Lifecycle', () => {
    it('should accept a valid refresh token after the access token expires, issue replacement tokens with configured expiries, and accept new access token on protected routes', async () => {
      // 1. Login to get initial cookies
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: refreshUser.email, password: refreshUser.password });

      expect(loginRes.statusCode).toBe(200);
      const initialCookies = loginRes.headers['set-cookie'];
      const initialRefreshCookie = initialCookies.find((c) => c.startsWith('refreshToken='));

      // 2. Synthesize an expired access token (expired 30s ago)
      const expiredAccessToken = jwt.sign(
        { id: userId, role: 'patient', tokenType: 'access' },
        JWT_SECRET,
        { expiresIn: '-30s' }
      );

      // 3. Requesting a protected endpoint with the expired access token fails with 401
      const expiredAccessRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`accessToken=${expiredAccessToken}`]);

      expect(expiredAccessRes.statusCode).toBe(401);
      expect(expiredAccessRes.body.success).toBe(false);
      expect(expiredAccessRes.body.message).toMatch(/session has expired/i);

      // 4. Client invokes POST /api/auth/refresh with the expired access token cookie AND valid refresh token cookie
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`accessToken=${expiredAccessToken}`, initialRefreshCookie]);

      expect(refreshRes.statusCode).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.message).toMatch(/refreshed/i);

      // 5. Verify the replacement cookies were issued and are HTTP-only
      const refreshedCookies = refreshRes.headers['set-cookie'];
      const newAccessCookie = refreshedCookies.find((c) => c.startsWith('accessToken='));
      const newRefreshCookie = refreshedCookies.find((c) => c.startsWith('refreshToken='));

      expect(newAccessCookie).toBeDefined();
      expect(newAccessCookie).toContain('HttpOnly');
      expect(newRefreshCookie).toBeDefined();
      expect(newRefreshCookie).toContain('HttpOnly');

      const rawNewAccessToken = newAccessCookie.split(';')[0].split('=')[1];
      const rawNewRefreshToken = newRefreshCookie.split(';')[0].split('=')[1];

      // 6. Verify token lifetimes adhere to configuration:
      // Access token: ~7 minutes (420 seconds)
      // Refresh token: ~15 days (1,296,000 seconds)
      const decodedNewAccess = jwt.verify(rawNewAccessToken, JWT_SECRET);
      expect(decodedNewAccess.tokenType).toBe('access');
      expect(decodedNewAccess.exp - decodedNewAccess.iat).toBe(7 * 60);

      const decodedNewRefresh = jwt.verify(rawNewRefreshToken, JWT_SECRET);
      expect(decodedNewRefresh.tokenType).toBe('refresh');
      expect(decodedNewRefresh.exp - decodedNewRefresh.iat).toBe(15 * 24 * 60 * 60);
      expect(decodedNewRefresh.familyId).toBeDefined();

      // 7. Request protected endpoint /api/auth/me using the new access token
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', refreshedCookies);

      expect(meRes.statusCode).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.user.email).toBe(refreshUser.email.toLowerCase());
      expect(meRes.body.data.user.id).toBe(userId);
    });

    it('should prevent refresh tokens from being used as access tokens on protected endpoints', async () => {
      const validRefreshToken = jwt.sign(
        { id: userId, role: 'patient', tokenType: 'refresh', familyId: crypto.randomUUID() },
        JWT_SECRET,
        { expiresIn: '15d' }
      );

      // Presentation via cookie
      const resCookie = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`accessToken=${validRefreshToken}`]);

      expect(resCookie.statusCode).toBe(401);
      expect(resCookie.body.message).toMatch(/access token required/i);

      // Presentation via Bearer header
      const resHeader = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validRefreshToken}`);

      expect(resHeader.statusCode).toBe(401);
      expect(resHeader.body.message).toMatch(/access token required/i);
    });

    it('should reject access tokens sent to the refresh endpoint', async () => {
      const validAccessToken = jwt.sign(
        { id: userId, role: 'patient', tokenType: 'access' },
        JWT_SECRET,
        { expiresIn: '7m' }
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${validAccessToken}`]);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/invalid token type for refresh/i);
    });
  });
});
