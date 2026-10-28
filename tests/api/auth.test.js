require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_automated_testing_12345';
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool } = require('../../src/config/db');

describe('Authentication Module (/api/auth)', () => {
  const testUser = {
    name: 'Sita Sharma',
    email: 'sita.sharma@testauth.example.com',
    password: 'SecureAyurPassword123!',
    role: 'patient'
  };

  const testDoctor = {
    name: 'Dr. Vaidya Vasant',
    email: 'dr.vasant@testdoctor.example.com',
    password: 'SecureDoctorPassword123!',
    role: 'doctor'
  };

  const JWT_SECRET = process.env.JWT_SECRET;
  let patientUserId;

  // Clean up test data before and after test execution
  beforeAll(async () => {
    await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [
      testUser.email.toLowerCase(),
      testDoctor.email.toLowerCase(),
      'rollback.doc@testauth.example.com'
    ]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [
      testUser.email.toLowerCase(),
      testDoctor.email.toLowerCase(),
      'rollback.doc@testauth.example.com'
    ]);
  });

  describe('POST /api/auth/signup', () => {
    it('should successfully register a new user and set HTTP-only cookies', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send(testUser);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.name).toBe(testUser.name);
      expect(res.body.data.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.data.user.role).toBe('patient');
      patientUserId = res.body.data.user.id;

      // Tokens should NOT be returned in JSON response when stored in cookies
      expect(res.body.data.token).toBeUndefined();
      expect(res.body.data.accessToken).toBeUndefined();
      expect(res.body.data.refreshToken).toBeUndefined();

      // Ensure password and password_hash are NEVER exposed in the response
      expect(res.body.data.user.password).toBeUndefined();
      expect(res.body.data.user.password_hash).toBeUndefined();

      // Ensure HTTP-only cookies are set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.startsWith('accessToken=') && c.includes('HttpOnly'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refreshToken=') && c.includes('HttpOnly'))).toBe(true);
    });

    it('should verify patient registration creates a user and profile but NO doctor record', async () => {
      // User must exist
      const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [patientUserId]);
      expect(userRes.rows.length).toBe(1);

      // Profile must exist
      const profileRes = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [patientUserId]);
      expect(profileRes.rows.length).toBe(1);

      // Doctors table must NOT have a record for this patient
      const docRes = await pool.query('SELECT * FROM doctors WHERE user_id = $1', [patientUserId]);
      expect(docRes.rows.length).toBe(0);
    });

    it('should verify password hashing in the database (never plaintext)', async () => {
      const dbRes = await pool.query('SELECT password_hash FROM users WHERE email = $1', [testUser.email.toLowerCase()]);
      expect(dbRes.rows.length).toBe(1);

      const storedHash = dbRes.rows[0].password_hash;
      expect(storedHash).not.toBe(testUser.password);
      expect(storedHash.startsWith('$2')).toBe(true); // bcrypt prefix

      const isMatch = await bcrypt.compare(testUser.password, storedHash);
      expect(isMatch).toBe(true);
    });

    it('should reject duplicate email registration with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send(testUser);

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should reject missing or invalid signup fields with 400 Bad Request', async () => {
      // Missing email
      const res1 = await request(app)
        .post('/api/auth/signup')
        .send({ name: 'Test', password: 'password123' });
      expect(res1.statusCode).toBe(400);
      expect(res1.body.success).toBe(false);

      // Invalid email format
      const res2 = await request(app)
        .post('/api/auth/signup')
        .send({ name: 'Test', email: 'not-an-email', password: 'password123' });
      expect(res2.statusCode).toBe(400);

      // Password shorter than 8 characters
      const res3 = await request(app)
        .post('/api/auth/signup')
        .send({ name: 'Test', email: 'valid@example.com', password: 'short' });
      expect(res3.statusCode).toBe(400);
    });

    it('should reject self-registration with admin role with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Hacker Admin',
          email: 'hacker@example.com',
          password: 'Password123!',
          role: 'admin'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Doctor Registration & Transaction Integrity', () => {
    let doctorUserId;

    it('should successfully register doctor, creating user, profile, and pending doctor record', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send(testDoctor);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.name).toBe(testDoctor.name);
      expect(res.body.data.user.email).toBe(testDoctor.email.toLowerCase());
      expect(res.body.data.user.role).toBe('doctor');

      // Response does not expose sensitive fields
      expect(res.body.data.user.password).toBeUndefined();
      expect(res.body.data.user.password_hash).toBeUndefined();
      expect(res.body.data.token).toBeUndefined();

      doctorUserId = res.body.data.user.id;

      // Verify user record created
      const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [doctorUserId]);
      expect(userRes.rows.length).toBe(1);

      // Verify profile record created
      const profileRes = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [doctorUserId]);
      expect(profileRes.rows.length).toBe(1);

      // Verify doctor record created linked to users.id
      const doctorRes = await pool.query('SELECT * FROM doctors WHERE user_id = $1', [doctorUserId]);
      expect(doctorRes.rows.length).toBe(1);
      const docRecord = doctorRes.rows[0];

      expect(docRecord.user_id).toBe(doctorUserId);
      expect(docRecord.verification_status).toBe('pending');
      expect(docRecord.experience_years).toBe(0);
      expect(Number(docRecord.consultation_fee)).toBe(0);
      expect(docRecord.specialization).toBe('General Medicine');
      expect(docRecord.qualification).toBe('Not Specified');
    });

    it('should reject duplicate doctor registration with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send(testDoctor);

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should allow registered doctor to log in and rotate tokens', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testDoctor.email,
          password: testDoctor.password
        });

      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.body.success).toBe(true);
      expect(loginRes.body.data.user.role).toBe('doctor');

      const cookies = loginRes.headers['set-cookie'];
      expect(cookies.some((c) => c.startsWith('accessToken='))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookies);

      expect(refreshRes.statusCode).toBe(200);
      expect(refreshRes.body.success).toBe(true);
    });

    it('should roll back both user and profile inserts if doctor-record creation fails (atomic transaction)', async () => {
      const rollbackEmail = 'rollback.doc@testauth.example.com';
      const authQuery = require('../../src/query/auth.query');

      // Attempt registration with an invalid specialization that exceeds VARCHAR(100)
      // This will succeed on user and profile inserts, but fail on doctor insert, triggering ROLLBACK
      const invalidLongSpecialization = 'X'.repeat(150);

      let caughtError;
      try {
        await authQuery.createUser({
          name: 'Rollback Doctor',
          email: rollbackEmail,
          passwordHash: '$2a$10$FakeHashForTestingOnly123',
          role: 'doctor',
          specialization: invalidLongSpecialization
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.code).toBe('22001'); // PostgreSQL string_data_right_truncation

      // Verify transaction rollback: zero orphaned records in users, profiles, or doctors
      const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [rollbackEmail]);
      expect(userCheck.rows.length).toBe(0);

      const profileCheck = await pool.query(
        'SELECT p.* FROM profiles p JOIN users u ON p.user_id = u.id WHERE u.email = $1',
        [rollbackEmail]
      );
      expect(profileCheck.rows.length).toBe(0);

      const docCheck = await pool.query(
        'SELECT d.* FROM doctors d JOIN users u ON d.user_id = u.id WHERE u.email = $1',
        [rollbackEmail]
      );
      expect(docCheck.rows.length).toBe(0);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should successfully log in with valid credentials and return JWT cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.data.user.password_hash).toBeUndefined();

      // Tokens should NOT be in JSON body
      expect(res.body.data.token).toBeUndefined();

      // Verify HTTP-only cookies
      const cookies = res.headers['set-cookie'];
      expect(cookies.some((c) => c.startsWith('accessToken=') && c.includes('HttpOnly'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refreshToken=') && c.includes('HttpOnly'))).toBe(true);
    });

    it('should reject login with incorrect password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!'
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('should reject login with unknown email with 401 Unauthorized (no enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent.user.999@testauth.example.com',
          password: 'SomePassword123!'
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('should reject login for inactive accounts with 403 Forbidden', async () => {
      await pool.query("UPDATE users SET status = 'inactive' WHERE email = $1", [testUser.email.toLowerCase()]);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/inactive|suspended/i);

      // Restore active status
      await pool.query("UPDATE users SET status = 'active' WHERE email = $1", [testUser.email.toLowerCase()]);
    });

    it('should issue access token with 7m expiry and refresh token with 15d expiry in cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        });

      expect(res.statusCode).toBe(200);
      const cookies = res.headers['set-cookie'];
      const accessCookie = cookies.find((c) => c.startsWith('accessToken='));
      const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
      expect(accessCookie).toBeDefined();
      expect(refreshCookie).toBeDefined();

      const accessToken = accessCookie.split(';')[0].split('=')[1];
      const refreshToken = refreshCookie.split(';')[0].split('=')[1];

      const decodedAccess = jwt.decode(accessToken);
      const decodedRefresh = jwt.decode(refreshToken);

      expect(decodedAccess.exp - decodedAccess.iat).toBe(7 * 60); // 7 minutes = 420s
      expect(decodedRefresh.exp - decodedRefresh.iat).toBe(15 * 24 * 60 * 60); // 15 days = 1296000s
    });
  });

  describe('JWT Verification & Middleware', () => {
    it('should reject request without token on protected route with 401', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid or malformed JWT with 401', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.token.signature');

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject expired JWT with 401', async () => {
      // Create token that expired 10 seconds ago
      const expiredToken = jwt.sign(
        { id: 1, role: 'patient' },
        JWT_SECRET,
        { expiresIn: '-10s' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('should reject refresh token when presented as an access token on protected routes with 401', async () => {
      const refreshToken = jwt.sign(
        { id: 1, role: 'patient', tokenType: 'refresh' },
        JWT_SECRET,
        { expiresIn: '15d' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshToken}`);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/access token required/i);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return safe user profile when authenticated via cookie', async () => {
      // First login to get cookie
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const cookie = loginRes.headers['set-cookie'];

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookie);

      expect(meRes.statusCode).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.user.email).toBe(testUser.email.toLowerCase());
      expect(meRes.body.data.user.role).toBe('patient');
      expect(meRes.body.data.user.profile).toBeDefined();
      expect(meRes.body.data.user.password_hash).toBeUndefined();
    });

    it('should return safe user profile when authenticated via Bearer header', async () => {
      // Login to get access token from set-cookie
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const accessCookie = loginRes.headers['set-cookie'].find((c) => c.startsWith('accessToken='));
      const token = accessCookie.split(';')[0].split('=')[1];

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.statusCode).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.user.email).toBe(testUser.email.toLowerCase());
      expect(meRes.body.data.user.password_hash).toBeUndefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear authentication cookies on logout', async () => {
      const res = await request(app)
        .post('/api/auth/logout');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/logged out/i);

      // Verify clear cookie header for accessToken and refreshToken
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.startsWith('accessToken=;') || c.includes('accessToken='))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refreshToken=;') || c.includes('refreshToken='))).toBe(true);
    });
  });
});
