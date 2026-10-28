require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_automated_testing_12345';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool } = require('../../src/config/db');

describe('Admin Management & Doctor Verification (/api/admin)', () => {
  const JWT_SECRET = process.env.JWT_SECRET;

  let adminToken;
  let doctorToken;
  let patientToken;

  let testAdminUser;
  let testDoctorUser;
  let testDoctorProfile;
  let testPatientUser;

  beforeAll(async () => {
    // Clean up test users
    await pool.query(
      `DELETE FROM users WHERE email IN ($1, $2, $3)`,
      [
        'admin.verify.test@example.com',
        'doctor.verify.test@example.com',
        'patient.verify.test@example.com'
      ]
    );

    // 1. Create Admin user
    const adminRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Admin Tester', 'admin.verify.test@example.com', '$2a$10$FakeHashForTestingOnly123', 'admin', 'active')
      RETURNING id, name, email, role, status;
    `);
    testAdminUser = adminRes.rows[0];
    adminToken = jwt.sign({ id: testAdminUser.id, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Create Doctor user & pending doctor profile
    const docUserRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Dr. Pending Tester', 'doctor.verify.test@example.com', '$2a$10$FakeHashForTestingOnly123', 'doctor', 'active')
      RETURNING id, name, email, role, status;
    `);
    testDoctorUser = docUserRes.rows[0];
    doctorToken = jwt.sign({ id: testDoctorUser.id, role: 'doctor' }, JWT_SECRET, { expiresIn: '1h' });

    const docProfileRes = await pool.query(`
      INSERT INTO doctors (user_id, specialization, qualification, experience_years, consultation_fee, verification_status)
      VALUES ($1, 'Shalakya Tantra', 'BAMS, MD', 6, 450.00, 'pending')
      RETURNING id, user_id, specialization, qualification, experience_years, consultation_fee, verification_status;
    `, [testDoctorUser.id]);
    testDoctorProfile = docProfileRes.rows[0];

    // 3. Create Patient user
    const patientRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Patient Tester', 'patient.verify.test@example.com', '$2a$10$FakeHashForTestingOnly123', 'patient', 'active')
      RETURNING id, name, email, role, status;
    `);
    testPatientUser = patientRes.rows[0];
    patientToken = jwt.sign({ id: testPatientUser.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM users WHERE email IN ($1, $2, $3)`,
      [
        'admin.verify.test@example.com',
        'doctor.verify.test@example.com',
        'patient.verify.test@example.com'
      ]
    );
  });

  describe('GET /api/admin/metrics', () => {
    it('should return system metrics for authenticated admin', async () => {
      const res = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metrics).toBeDefined();
      expect(res.body.data.metrics.total_users).toBeDefined();
      expect(res.body.data.metrics.active_doctors).toBeDefined();
    });

    it('should reject non-admin users with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/admin/metrics');
      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/admin/doctors/pending', () => {
    it('should return pending doctors with distinct id (doctors.id) and user_id (users.id)', async () => {
      const res = await request(app)
        .get('/api/admin/doctors/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.doctors)).toBe(true);

      const targetDoc = res.body.data.doctors.find((d) => d.id === testDoctorProfile.id);
      expect(targetDoc).toBeDefined();

      // Crucial ID consistency assertion:
      // id represents doctors.id, while user_id represents users.id
      expect(targetDoc.id).toBe(testDoctorProfile.id);
      expect(targetDoc.user_id).toBe(testDoctorUser.id);
      expect(targetDoc.verification_status).toBe('pending');
      expect(targetDoc.name).toBe(testDoctorUser.name);
      expect(targetDoc.email).toBe(testDoctorUser.email);
    });

    it('should reject access from non-admin role with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/admin/doctors/pending')
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PATCH /api/admin/doctors/:id/verify', () => {
    it('should verify a doctor using doctors.id and return both id and user_id', async () => {
      const res = await request(app)
        .patch(`/api/admin/doctors/${testDoctorProfile.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'verified' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/verified/i);

      // Verify returned doctor exposes both id and user_id
      expect(res.body.data.doctor).toBeDefined();
      expect(res.body.data.doctor.id).toBe(testDoctorProfile.id);
      expect(res.body.data.doctor.user_id).toBe(testDoctorUser.id);
      expect(res.body.data.doctor.verification_status).toBe('verified');
      expect(res.body.data.doctor.name).toBe(testDoctorUser.name);
      expect(res.body.data.doctor.email).toBe(testDoctorUser.email);

      // Verify database update
      const dbCheck = await pool.query('SELECT verification_status FROM doctors WHERE id = $1', [testDoctorProfile.id]);
      expect(dbCheck.rows[0].verification_status).toBe('verified');

      // Verify audit log entry was created
      const auditLog = await pool.query(
        "SELECT * FROM audit_logs WHERE action = 'ADMIN_DOCTOR_VERIFIED' AND entity_id = $1 ORDER BY id DESC LIMIT 1",
        [testDoctorProfile.id]
      );
      expect(auditLog.rows.length).toBe(1);
      expect(auditLog.rows[0].actor_user_id).toBe(testAdminUser.id);
    });

    it('should reject invalid status with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/admin/doctors/${testDoctorProfile.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'invalid_status' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/verified.*rejected/i);
    });

    it('should reject invalid non-numeric doctor ID with 400 Bad Request', async () => {
      const res = await request(app)
        .patch('/api/admin/doctors/not-a-number/verify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'verified' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 for non-existent doctor ID', async () => {
      const res = await request(app)
        .patch('/api/admin/doctors/999999/verify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'verified' });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });

    it('should reject verification attempts from unauthorized users with 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/admin/doctors/${testDoctorProfile.id}/verify`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ status: 'verified' });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
