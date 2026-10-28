require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_automated_testing_12345';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool } = require('../../src/config/db');

describe('Profile Management Tests (/api/users/profile & /api/doctors)', () => {
  const JWT_SECRET = process.env.JWT_SECRET;

  let patient1User, patient1Token;
  let patient2User, patient2Token;
  let doctor1User, doctor1Profile, doctor1Token;
  let doctor2User, doctor2Profile, doctor2Token;
  let adminUser, adminToken;

  beforeAll(async () => {
    // Clean up test data
    await pool.query(
      `DELETE FROM users WHERE email IN ($1, $2, $3, $4, $5)`,
      [
        'patient1.profile.test@example.com',
        'patient2.profile.test@example.com',
        'doctor1.profile.test@example.com',
        'doctor2.profile.test@example.com',
        'admin.profile.test@example.com'
      ]
    );

    // 1. Create Patient 1
    const p1Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Aarohi Sharma', 'patient1.profile.test@example.com', '$2a$10$FakeHashForTestingOnly123', 'patient', 'active')
      RETURNING id, name, email, role, status;
    `);
    patient1User = p1Res.rows[0];
    patient1Token = jwt.sign({ id: patient1User.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });

    await pool.query(`
      INSERT INTO profiles (user_id, phone, date_of_birth, gender, address, emergency_contact)
      VALUES ($1, '+919876543210', '1990-05-15', 'male', '123 Herbal Way', 'Family: +919876500000');
    `, [patient1User.id]);

    // 2. Create Patient 2
    const p2Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Meera Joshi', 'patient2.profile.test@example.com', '$2a$10$FakeHashForTestingOnly123', 'patient', 'active')
      RETURNING id, name, email, role, status;
    `);
    patient2User = p2Res.rows[0];
    patient2Token = jwt.sign({ id: patient2User.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });

    await pool.query(`
      INSERT INTO profiles (user_id, phone, date_of_birth, gender, address, emergency_contact)
      VALUES ($1, '+919123456789', '1995-08-20', 'female', '456 Green Street', 'Friend: +919123400000');
    `, [patient2User.id]);

    // 3. Create Doctor 1 (Verified)
    const d1Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Dr. Kavi Varma', 'doctor1.profile.test@example.com', '$2a$10$FakeHashForTestingOnly123', 'doctor', 'active')
      RETURNING id, name, email, role, status;
    `);
    doctor1User = d1Res.rows[0];
    doctor1Token = jwt.sign({ id: doctor1User.id, role: 'doctor' }, JWT_SECRET, { expiresIn: '1h' });

    const doc1ProfRes = await pool.query(`
      INSERT INTO doctors (user_id, specialization, qualification, experience_years, consultation_fee, verification_status, bio)
      VALUES ($1, 'Kayachikitsa', 'BAMS, MD', 10, 500.00, 'verified', 'Experienced Ayurvedic Physician')
      RETURNING id, user_id, specialization, qualification, experience_years, consultation_fee, verification_status, bio;
    `, [doctor1User.id]);
    doctor1Profile = doc1ProfRes.rows[0];

    // 4. Create Doctor 2 (Unverified / Pending)
    const d2Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Dr. Tarun Sen', 'doctor2.profile.test@example.com', '$2a$10$FakeHashForTestingOnly123', 'doctor', 'active')
      RETURNING id, name, email, role, status;
    `);
    doctor2User = d2Res.rows[0];
    doctor2Token = jwt.sign({ id: doctor2User.id, role: 'doctor' }, JWT_SECRET, { expiresIn: '1h' });

    const doc2ProfRes = await pool.query(`
      INSERT INTO doctors (user_id, specialization, qualification, experience_years, consultation_fee, verification_status, bio)
      VALUES ($1, 'Shalya Tantra', 'BAMS, MS', 4, 400.00, 'pending', 'Ayurvedic Surgeon in training')
      RETURNING id, user_id, specialization, qualification, experience_years, consultation_fee, verification_status, bio;
    `, [doctor2User.id]);
    doctor2Profile = doc2ProfRes.rows[0];

    // 5. Create Admin
    const adminRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Admin System', 'admin.profile.test@example.com', '$2a$10$FakeHashForTestingOnly123', 'admin', 'active')
      RETURNING id, name, email, role, status;
    `);
    adminUser = adminRes.rows[0];
    adminToken = jwt.sign({ id: adminUser.id, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM users WHERE email IN ($1, $2, $3, $4, $5)`,
      [
        'patient1.profile.test@example.com',
        'patient2.profile.test@example.com',
        'doctor1.profile.test@example.com',
        'doctor2.profile.test@example.com',
        'admin.profile.test@example.com'
      ]
    );
  });

  // =========================================================================
  // 1. PATIENT PROFILE MANAGEMENT
  // =========================================================================
  describe('Patient Profile Management (/api/users/profile)', () => {
    it('1. Patient retrieves their own profile', async () => {
      const res = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile).toBeDefined();

      const p = res.body.data.profile;
      expect(p.id).toBe(patient1User.id);
      expect(p.name).toBe('Aarohi Sharma');
      expect(p.email).toBe('patient1.profile.test@example.com');
      expect(p.role).toBe('patient');
      expect(p.phone).toBe('+919876543210');
      expect(p.date_of_birth).toBe('1990-05-15');
      expect(p.gender).toBe('male');
      expect(p.address).toBe('123 Herbal Way');
      expect(p.emergency_contact).toBe('Family: +919876500000');
      expect(p.created_at).toBeDefined();
      expect(p.updated_at).toBeDefined();

      // Ensure no password hashes or tokens leaked
      expect(p.password_hash).toBeUndefined();
      expect(p.password).toBeUndefined();
      expect(p.refreshToken).toBeUndefined();
    });

    it('2. Patient successfully updates their own profile', async () => {
      const res = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          name: 'Aarohi Sharma Updated',
          phone: '+919999988888',
          address: '789 Wellness Lane'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/updated/i);
      expect(res.body.data.profile.name).toBe('Aarohi Sharma Updated');
      expect(res.body.data.profile.phone).toBe('+919999988888');
      expect(res.body.data.profile.address).toBe('789 Wellness Lane');
    });

    it('3. Partial updates preserve omitted fields', async () => {
      // Update only phone; name, address, date_of_birth, gender must be preserved
      const res = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          phone: '+919999911111'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile.phone).toBe('+919999911111');

      // Verify omitted fields remain intact
      expect(res.body.data.profile.name).toBe('Aarohi Sharma Updated');
      expect(res.body.data.profile.address).toBe('789 Wellness Lane');
      expect(res.body.data.profile.date_of_birth).toBe('1990-05-15');
      expect(res.body.data.profile.gender).toBe('male');
      expect(res.body.data.profile.emergency_contact).toBe('Family: +919876500000');

      // Double-check PostgreSQL directly
      const dbProfile = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [patient1User.id]);
      expect(dbProfile.rows[0].phone).toBe('+919999911111');
      expect(dbProfile.rows[0].address).toBe('789 Wellness Lane');
      expect(dbProfile.rows[0].gender).toBe('male');
    });

    it('4. Patient cannot update another user profile via request body ID', async () => {
      // Passing id or user_id in body must be rejected by strict validation
      const res = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          id: patient2User.id,
          user_id: patient2User.id,
          phone: '+919000000000'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);

      // Verify Patient 2 profile was NOT modified
      const p2Check = await pool.query('SELECT phone FROM profiles WHERE user_id = $1', [patient2User.id]);
      expect(p2Check.rows[0].phone).toBe('+919123456789');
    });

    it('5. Patient cannot change their role to admin or doctor', async () => {
      const res = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          role: 'admin'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);

      // Verify DB role
      const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [patient1User.id]);
      expect(userCheck.rows[0].role).toBe('patient');
    });

    it('6. Patient cannot modify protected authentication fields', async () => {
      const res = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          password_hash: '$2a$10$MaliciousHashedPassword123',
          status: 'suspended'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);

      // Verify DB password_hash and status
      const userCheck = await pool.query('SELECT password_hash, status FROM users WHERE id = $1', [patient1User.id]);
      expect(userCheck.rows[0].password_hash).toBe('$2a$10$FakeHashForTestingOnly123');
      expect(userCheck.rows[0].status).toBe('active');
    });

    it('7. Invalid fields and data types are rejected with 400 Bad Request', async () => {
      // Invalid email format
      const resEmail = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ email: 'not-a-valid-email' });
      expect(resEmail.statusCode).toBe(400);
      expect(resEmail.body.success).toBe(false);

      // Invalid phone format
      const resPhone = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ phone: 'invalid-phone-string' });
      expect(resPhone.statusCode).toBe(400);

      // Invalid date format
      const resDob = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ date_of_birth: '15/05/1990' });
      expect(resDob.statusCode).toBe(400);

      // Invalid gender
      const resGender = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ gender: 'unsupported_gender' });
      expect(resGender.statusCode).toBe(400);

      // Unsupported extra field
      const resExtra = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ custom_unsupported_field: 'testing' });
      expect(resExtra.statusCode).toBe(400);
    });

    it('8. Unauthenticated requests are rejected with 401 Unauthorized', async () => {
      const getRes = await request(app).get('/api/users/profile');
      expect(getRes.statusCode).toBe(401);
      expect(getRes.body.success).toBe(false);

      const putRes = await request(app)
        .put('/api/users/profile')
        .send({ phone: '+919999900000' });
      expect(putRes.statusCode).toBe(401);
      expect(putRes.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. DOCTOR PROFILE MANAGEMENT
  // =========================================================================
  describe('Doctor Profile Management (/api/doctors/profile)', () => {
    it('1. Doctor retrieves their own professional profile', async () => {
      const res = await request(app)
        .get('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.doctor).toBeDefined();

      const doc = res.body.data.doctor;
      expect(doc.id).toBe(doctor1Profile.id);
      expect(doc.user_id).toBe(doctor1User.id);
      expect(doc.name).toBe('Dr. Kavi Varma');
      expect(doc.specialization).toBe('Kayachikitsa');
      expect(doc.qualification).toBe('BAMS, MD');
      expect(doc.experience_years).toBe(10);
      expect(parseFloat(doc.consultation_fee)).toBe(500.00);
      expect(doc.verification_status).toBe('verified');
      expect(doc.bio).toBe('Experienced Ayurvedic Physician');

      // No sensitive auth data exposed
      expect(doc.password_hash).toBeUndefined();
      expect(doc.password).toBeUndefined();
    });

    it('2. Doctor successfully updates their own professional fields', async () => {
      const res = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          specialization: 'Kayachikitsa & Panchakarma',
          qualification: 'BAMS, MD, PhD (Ayu)',
          experience_years: 12,
          consultation_fee: 650.00,
          bio: 'Senior Ayurvedic Consultant with 12+ years clinical experience'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/updated/i);

      const doc = res.body.data.doctor;
      expect(doc.specialization).toBe('Kayachikitsa & Panchakarma');
      expect(doc.qualification).toBe('BAMS, MD, PhD (Ayu)');
      expect(doc.experience_years).toBe(12);
      expect(parseFloat(doc.consultation_fee)).toBe(650.00);
      expect(doc.bio).toBe('Senior Ayurvedic Consultant with 12+ years clinical experience');
    });

    it('3. Partial updates preserve omitted fields', async () => {
      // Update only consultation_fee; specialization, qualification, experience, bio must be preserved
      const res = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          consultation_fee: 750.00
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const doc = res.body.data.doctor;
      expect(parseFloat(doc.consultation_fee)).toBe(750.00);
      expect(doc.specialization).toBe('Kayachikitsa & Panchakarma');
      expect(doc.qualification).toBe('BAMS, MD, PhD (Ayu)');
      expect(doc.experience_years).toBe(12);
      expect(doc.bio).toBe('Senior Ayurvedic Consultant with 12+ years clinical experience');

      // Direct DB verification
      const dbDoc = await pool.query('SELECT * FROM doctors WHERE id = $1', [doctor1Profile.id]);
      expect(parseFloat(dbDoc.rows[0].consultation_fee)).toBe(750.00);
      expect(dbDoc.rows[0].specialization).toBe('Kayachikitsa & Panchakarma');
      expect(dbDoc.rows[0].experience_years).toBe(12);
    });

    it('4. Doctor cannot update another doctor profile via body IDs', async () => {
      const res = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          id: doctor2Profile.id,
          user_id: doctor2User.id,
          consultation_fee: 999.00
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);

      // Verify Doctor 2 was NOT modified
      const d2Check = await pool.query('SELECT consultation_fee FROM doctors WHERE id = $1', [doctor2Profile.id]);
      expect(parseFloat(d2Check.rows[0].consultation_fee)).toBe(400.00);
    });

    it('5. Doctor cannot set their own is_verified or verification_status', async () => {
      // Doctor 2 is pending, attempts to self-verify
      const res = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor2Token}`)
        .send({
          verification_status: 'verified',
          is_verified: true
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);

      // Verify Doctor 2 is still pending in DB
      const d2Check = await pool.query('SELECT verification_status FROM doctors WHERE id = $1', [doctor2Profile.id]);
      expect(d2Check.rows[0].verification_status).toBe('pending');
    });

    it('6. Doctor cannot change their role or authentication fields', async () => {
      const res = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          role: 'admin',
          password_hash: '$2a$10$FakeHackedPassword'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);

      // Verify DB role
      const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [doctor1User.id]);
      expect(userCheck.rows[0].role).toBe('doctor');
    });

    it('7. Invalid experience and consultation fees are rejected', async () => {
      // Negative experience
      const resNegExp = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ experience_years: -3 });
      expect(resNegExp.statusCode).toBe(400);

      // Negative fee
      const resNegFee = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ consultation_fee: -100 });
      expect(resNegFee.statusCode).toBe(400);

      // Non-integer experience
      const resFloatExp = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ experience_years: 5.5 });
      expect(resFloatExp.statusCode).toBe(400);

      // Bio exceeds max length
      const resLongBio = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ bio: 'x'.repeat(1001) });
      expect(resLongBio.statusCode).toBe(400);
    });

    it('8. Patient accounts cannot access the doctor profile endpoints', async () => {
      const getRes = await request(app)
        .get('/api/doctors/profile')
        .set('Authorization', `Bearer ${patient1Token}`);
      expect(getRes.statusCode).toBe(403);
      expect(getRes.body.success).toBe(false);

      const putRes = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ consultation_fee: 500 });
      expect(putRes.statusCode).toBe(403);
      expect(putRes.body.success).toBe(false);
    });

    it('9. Unauthenticated requests are rejected', async () => {
      const getRes = await request(app).get('/api/doctors/profile');
      expect(getRes.statusCode).toBe(401);
      expect(getRes.body.success).toBe(false);

      const putRes = await request(app)
        .put('/api/doctors/profile')
        .send({ consultation_fee: 500 });
      expect(putRes.statusCode).toBe(401);
      expect(putRes.body.success).toBe(false);
    });

    it('10. Doctor profile lookup correctly distinguishes doctors.id from users.id', async () => {
      // Requesting doctor by doctors.id
      const res = await request(app).get(`/api/doctors/${doctor1Profile.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.doctor.id).toBe(doctor1Profile.id);
      expect(res.body.data.doctor.user_id).toBe(doctor1User.id);
    });
  });

  // =========================================================================
  // 3. PUBLIC DOCTOR DETAIL
  // =========================================================================
  describe('Public Doctor Detail (/api/doctors/:id)', () => {
    it('1. Existing verified doctor profile can be retrieved publicly', async () => {
      const res = await request(app).get(`/api/doctors/${doctor1Profile.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.doctor).toBeDefined();

      const doc = res.body.data.doctor;
      expect(doc.id).toBe(doctor1Profile.id);
      expect(doc.user_id).toBe(doctor1User.id);
      expect(doc.name).toBe('Dr. Kavi Varma');
      expect(doc.specialization).toBe('Kayachikitsa & Panchakarma');
      expect(doc.qualification).toBe('BAMS, MD, PhD (Ayu)');
      expect(doc.verification_status).toBe('verified');
      expect(doc.bio).toBeDefined();
    });

    it('2. Nonexistent doctor profile returns 404', async () => {
      const res = await request(app).get('/api/doctors/999999');
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });

    it('3. Unverified doctor visibility follows privacy policy (hidden from public/patients, visible to self and admin)', async () => {
      // Public unauthenticated request for unverified doctor -> 404 Not Found
      const publicRes = await request(app).get(`/api/doctors/${doctor2Profile.id}`);
      expect(publicRes.statusCode).toBe(404);
      expect(publicRes.body.success).toBe(false);

      // Patient requesting unverified doctor -> 404 Not Found
      const patientRes = await request(app)
        .get(`/api/doctors/${doctor2Profile.id}`)
        .set('Authorization', `Bearer ${patient1Token}`);
      expect(patientRes.statusCode).toBe(404);
      expect(patientRes.body.success).toBe(false);

      // Doctor 2 requesting their own profile -> 200 OK
      const selfRes = await request(app)
        .get(`/api/doctors/${doctor2Profile.id}`)
        .set('Authorization', `Bearer ${doctor2Token}`);
      expect(selfRes.statusCode).toBe(200);
      expect(selfRes.body.success).toBe(true);
      expect(selfRes.body.data.doctor.id).toBe(doctor2Profile.id);

      // Admin requesting unverified doctor -> 200 OK
      const adminRes = await request(app)
        .get(`/api/doctors/${doctor2Profile.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.body.success).toBe(true);
      expect(adminRes.body.data.doctor.id).toBe(doctor2Profile.id);
    });

    it('4. Private account information and authentication secrets are not exposed', async () => {
      const res = await request(app).get(`/api/doctors/${doctor1Profile.id}`);
      expect(res.statusCode).toBe(200);

      const doc = res.body.data.doctor;
      expect(doc.password_hash).toBeUndefined();
      expect(doc.password).toBeUndefined();
      expect(doc.refreshToken).toBeUndefined();
    });
  });
});
