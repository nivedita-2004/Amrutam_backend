require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_automated_testing_12345';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool } = require('../../src/config/db');

describe('Doctor Availability and Consultation Booking (/api/availability & /api/consultations)', () => {
  const JWT_SECRET = process.env.JWT_SECRET;

  let doctor1User, doctor1;
  let doctor2User, doctor2;
  let patient1User;
  let patient2User;
  let inactivePatientUser;
  let adminUser;

  let doctor1Token;
  let doctor2Token;
  let patient1Token;
  let patient2Token;
  let inactivePatientToken;
  let adminToken;

  const cleanupTestData = async () => {
    await pool.query(`
      DELETE FROM prescriptions 
      WHERE doctor_id IN (
        SELECT id FROM doctors WHERE user_id IN (
          SELECT id FROM users WHERE email LIKE '%@bookingtest.example.com'
        )
      ) OR patient_id IN (
        SELECT id FROM users WHERE email LIKE '%@bookingtest.example.com'
      );
    `);
    await pool.query(`
      DELETE FROM payments 
      WHERE consultation_id IN (
        SELECT id FROM consultations WHERE doctor_id IN (
          SELECT id FROM doctors WHERE user_id IN (
            SELECT id FROM users WHERE email LIKE '%@bookingtest.example.com'
          )
        ) OR patient_id IN (
          SELECT id FROM users WHERE email LIKE '%@bookingtest.example.com'
        )
      );
    `);
    await pool.query(`
      DELETE FROM consultations 
      WHERE doctor_id IN (
        SELECT id FROM doctors WHERE user_id IN (
          SELECT id FROM users WHERE email LIKE '%@bookingtest.example.com'
        )
      ) OR patient_id IN (
        SELECT id FROM users WHERE email LIKE '%@bookingtest.example.com'
      );
    `);
    await pool.query(`
      DELETE FROM availability_slots 
      WHERE doctor_id IN (
        SELECT id FROM doctors WHERE user_id IN (
          SELECT id FROM users WHERE email LIKE '%@bookingtest.example.com'
        )
      );
    `);
    await pool.query(`
      DELETE FROM doctors 
      WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE '%@bookingtest.example.com'
      );
    `);
    await pool.query(`
      DELETE FROM users 
      WHERE email LIKE '%@bookingtest.example.com';
    `);
  };

  beforeAll(async () => {
    // Clean up any lingering test data
    await cleanupTestData();

    // Create Doctor 1 User & Doctor record
    const d1Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Dr. Charaka Sharma', 'dr.charaka@bookingtest.example.com', '$2a$10$FakeHashForTestingOnly123', 'doctor', 'active')
      RETURNING id, name, email, role, status;
    `);
    doctor1User = d1Res.rows[0];

    const doc1Res = await pool.query(`
      INSERT INTO doctors (user_id, specialization, qualification, experience_years, consultation_fee, verification_status)
      VALUES ($1, 'Kaya Chikitsa (Internal Medicine)', 'BAMS, MD (Ayurveda)', 12, 600.00, 'verified')
      RETURNING id, user_id, specialization;
    `, [doctor1User.id]);
    doctor1 = doc1Res.rows[0];

    // Create Doctor 2 User & Doctor record
    const d2Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Dr. Sushruta Varma', 'dr.sushruta@bookingtest.example.com', '$2a$10$FakeHashForTestingOnly123', 'doctor', 'active')
      RETURNING id, name, email, role, status;
    `);
    doctor2User = d2Res.rows[0];

    const doc2Res = await pool.query(`
      INSERT INTO doctors (user_id, specialization, qualification, experience_years, consultation_fee, verification_status)
      VALUES ($1, 'Shalya Tantra (Surgery & Marma)', 'BAMS, MS (Ayurveda)', 15, 800.00, 'verified')
      RETURNING id, user_id, specialization;
    `, [doctor2User.id]);
    doctor2 = doc2Res.rows[0];

    // Create Patient 1
    const p1Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Ananya Patel', 'ananya@bookingtest.example.com', '$2a$10$FakeHashForTestingOnly123', 'patient', 'active')
      RETURNING id, name, email, role, status;
    `);
    patient1User = p1Res.rows[0];

    // Create Patient 2
    const p2Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Rohan Gupta', 'rohan@bookingtest.example.com', '$2a$10$FakeHashForTestingOnly123', 'patient', 'active')
      RETURNING id, name, email, role, status;
    `);
    patient2User = p2Res.rows[0];

    // Create Inactive Patient
    const pInactRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Inactive User', 'inactive@bookingtest.example.com', '$2a$10$FakeHashForTestingOnly123', 'patient', 'inactive')
      RETURNING id, name, email, role, status;
    `);
    inactivePatientUser = pInactRes.rows[0];

    // Create Admin User
    const adminRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Admin Ayur', 'admin@bookingtest.example.com', '$2a$10$FakeHashForTestingOnly123', 'admin', 'active')
      RETURNING id, name, email, role, status;
    `);
    adminUser = adminRes.rows[0];

    // Create tokens
    doctor1Token = jwt.sign({ id: doctor1User.id, role: 'doctor' }, JWT_SECRET, { expiresIn: '1h' });
    doctor2Token = jwt.sign({ id: doctor2User.id, role: 'doctor' }, JWT_SECRET, { expiresIn: '1h' });
    patient1Token = jwt.sign({ id: patient1User.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });
    patient2Token = jwt.sign({ id: patient2User.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });
    inactivePatientToken = jwt.sign({ id: inactivePatientUser.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });
    adminToken = jwt.sign({ id: adminUser.id, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // =========================================================================
  // 1. DOCTOR AVAILABILITY TESTS
  // =========================================================================
  describe('Doctor Availability Management (/api/availability)', () => {
    let createdSlotId;

    it('should reject unauthenticated slot creation requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/availability')
        .send({
          start_time: new Date(Date.now() + 86400000).toISOString(),
          end_time: new Date(Date.now() + 90000000).toISOString()
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should allow an authenticated doctor to create their own availability slot', async () => {
      const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      start.setMinutes(0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: start.toISOString(),
          end_time: end.toISOString()
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slot).toBeDefined();
      expect(parseInt(res.body.data.slot.doctor_id, 10)).toBe(parseInt(doctor1.id, 10));
      expect(res.body.data.slot.status).toBe('available');

      createdSlotId = res.body.data.slot.id;
    });

    it('should reject availability slot creation when start_time is in the past', async () => {
      const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const pastEnd = new Date(Date.now() - 1 * 60 * 60 * 1000);

      const res = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: pastStart.toISOString(),
          end_time: pastEnd.toISOString()
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/future/i);
    });

    it('should reject availability slot creation when start_time is after end_time', async () => {
      const futureTime1 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const futureTime2 = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);

      const res = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: futureTime1.toISOString(),
          end_time: futureTime2.toISOString()
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/earlier/i);
    });

    it('should reject slot creation with invalid date format with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: 'not-a-valid-date',
          end_time: '2026-11-01T12:00:00Z'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid date/i);
    });

    it('should reject overlapping availability slots for the same doctor with 409 Conflict', async () => {
      const slotRes = await pool.query('SELECT start_time, end_time FROM availability_slots WHERE id = $1', [createdSlotId]);
      const existingStart = new Date(slotRes.rows[0].start_time);

      const overlapStart = new Date(existingStart.getTime() + 15 * 60 * 1000);
      const overlapEnd = new Date(existingStart.getTime() + 75 * 60 * 1000);

      const res = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: overlapStart.toISOString(),
          end_time: overlapEnd.toISOString()
        });

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/overlap/i);
    });

    it('should reject concurrent slot creation attempts with overlapping times for same doctor', async () => {
      const baseStart = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      baseStart.setMinutes(0, 0, 0);

      const reqA = request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: baseStart.toISOString(),
          end_time: new Date(baseStart.getTime() + 45 * 60 * 1000).toISOString()
        });

      const reqB = request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: new Date(baseStart.getTime() + 15 * 60 * 1000).toISOString(),
          end_time: new Date(baseStart.getTime() + 60 * 60 * 1000).toISOString()
        });

      const [resA, resB] = await Promise.all([reqA, reqB]);
      const statusCodes = [resA.statusCode, resB.statusCode];

      expect(statusCodes).toContain(201);
      expect(statusCodes).toContain(409);
    });

    it('should allow different doctors to have overlapping time slots', async () => {
      const sharedStart = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
      sharedStart.setMinutes(0, 0, 0);
      const sharedEnd = new Date(sharedStart.getTime() + 60 * 60 * 1000);

      // Doctor 1 creates slot at sharedStart
      const resDoc1 = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: sharedStart.toISOString(),
          end_time: sharedEnd.toISOString()
        });

      expect(resDoc1.statusCode).toBe(201);
      expect(resDoc1.body.success).toBe(true);
      const doc1SlotId = resDoc1.body.data.slot.id;

      // Doctor 2 creates slot at the EXACT same time
      const resDoc2 = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor2Token}`)
        .send({
          start_time: sharedStart.toISOString(),
          end_time: sharedEnd.toISOString()
        });

      expect(resDoc2.statusCode).toBe(201);
      expect(resDoc2.body.success).toBe(true);
      const doc2SlotId = resDoc2.body.data.slot.id;

      // Cleanup
      await pool.query('DELETE FROM availability_slots WHERE id IN ($1, $2)', [doc1SlotId, doc2SlotId]);
    });

    it('should allow adjacent slots for the same doctor without overlap conflict (e.g. 10:00-10:30 and 10:30-11:00)', async () => {
      const slot1Start = new Date(Date.now() + 26 * 24 * 60 * 60 * 1000);
      slot1Start.setMinutes(0, 0, 0);
      const slot1End = new Date(slot1Start.getTime() + 30 * 60 * 1000); // 10:00 - 10:30

      const slot2Start = new Date(slot1End.getTime()); // exactly 10:30
      const slot2End = new Date(slot2Start.getTime() + 30 * 60 * 1000); // 10:30 - 11:00

      const res1 = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: slot1Start.toISOString(),
          end_time: slot1End.toISOString()
        });

      expect(res1.statusCode).toBe(201);
      expect(res1.body.success).toBe(true);
      const id1 = res1.body.data.slot.id;

      const res2 = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: slot2Start.toISOString(),
          end_time: slot2End.toISOString()
        });

      expect(res2.statusCode).toBe(201);
      expect(res2.body.success).toBe(true);
      const id2 = res2.body.data.slot.id;

      // Cleanup
      await pool.query('DELETE FROM availability_slots WHERE id IN ($1, $2)', [id1, id2]);
    });

    it('should ignore cancelled slots when checking for overlaps', async () => {
      const cancelTestStart = new Date(Date.now() + 27 * 24 * 60 * 60 * 1000);
      cancelTestStart.setMinutes(0, 0, 0);
      const cancelTestEnd = new Date(cancelTestStart.getTime() + 60 * 60 * 1000); // 10:00 - 11:00

      // 1. Create slot
      const createRes = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: cancelTestStart.toISOString(),
          end_time: cancelTestEnd.toISOString()
        });

      expect(createRes.statusCode).toBe(201);
      const firstSlotId = createRes.body.data.slot.id;

      // 2. Cancel the slot
      const cancelRes = await request(app)
        .patch(`/api/availability/${firstSlotId}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ status: 'cancelled' });

      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.body.data.slot.status).toBe('cancelled');

      // 3. Create a new slot overlapping the cancelled slot time window (e.g. 10:15 - 10:45)
      const overlapStart = new Date(cancelTestStart.getTime() + 15 * 60 * 1000);
      const overlapEnd = new Date(cancelTestStart.getTime() + 45 * 60 * 1000);

      const recreateRes = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: overlapStart.toISOString(),
          end_time: overlapEnd.toISOString()
        });

      expect(recreateRes.statusCode).toBe(201);
      expect(recreateRes.body.success).toBe(true);
      const secondSlotId = recreateRes.body.data.slot.id;

      // Cleanup
      await pool.query('DELETE FROM availability_slots WHERE id IN ($1, $2)', [firstSlotId, secondSlotId]);
    });

    it('should reject slot creation if the user is a patient (role restriction)', async () => {
      const futureStart = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000);

      const res = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          start_time: futureStart.toISOString(),
          end_time: futureEnd.toISOString()
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should allow public/patient to view available slots with doctor filtering', async () => {
      const res = await request(app)
        .get(`/api/availability?doctor_id=${doctor1.id}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.slots)).toBe(true);
      expect(res.body.data.slots.some((s) => s.id === createdSlotId)).toBe(true);
    });

    it('should return only slots with doctor_id 62 when requesting doctor 62 and exclude doctor 67', async () => {
      // Ensure doctor 62 and doctor 67 exist in database
      const ensureDoctor = async (docId, email, name) => {
        let docCheck = await pool.query('SELECT id, user_id FROM doctors WHERE id = $1', [docId]);
        if (docCheck.rows.length === 0) {
          const userRes = await pool.query(
            `INSERT INTO users (name, email, password_hash, role, status)
             VALUES ($1, $2, '$2a$10$FakeHashForTestingOnly123', 'doctor', 'active')
             ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [name, email]
          );
          const userId = userRes.rows[0].id;
          await pool.query(
            `INSERT INTO doctors (id, user_id, specialization, qualification, experience_years, consultation_fee, verification_status)
             OVERRIDING SYSTEM VALUE
             VALUES ($1, $2, 'General Medicine', 'BAMS', 5, 500.00, 'verified')
             ON CONFLICT (id) DO NOTHING`,
            [docId, userId]
          );
        }
      };

      await ensureDoctor(62, 'doctor62.regression@bookingtest.example.com', 'Dr. Sixty Two');
      await ensureDoctor(67, 'doctor67.regression@bookingtest.example.com', 'Dr. Sixty Seven');

      const start62 = new Date('2029-03-01T10:00:00.000Z');
      const end62 = new Date('2029-03-01T10:30:00.000Z');

      const start67 = new Date('2029-03-02T10:00:00.000Z');
      const end67 = new Date('2029-03-02T10:30:00.000Z');

      // Clean up test slots if previously inserted
      await pool.query('DELETE FROM availability_slots WHERE doctor_id IN (62, 67) AND start_time IN ($1, $2)', [
        start62.toISOString(),
        start67.toISOString()
      ]);

      // Parameterized queries to insert slots
      const slot62Res = await pool.query(
        'INSERT INTO availability_slots (doctor_id, start_time, end_time, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [62, start62.toISOString(), end62.toISOString(), 'available']
      );
      const slot67Res = await pool.query(
        'INSERT INTO availability_slots (doctor_id, start_time, end_time, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [67, start67.toISOString(), end67.toISOString(), 'available']
      );

      const slot62Id = slot62Res.rows[0].id;
      const slot67Id = slot67Res.rows[0].id;

      // GET /api/availability/doctor/62
      const res = await request(app).get('/api/availability/doctor/62');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.slots)).toBe(true);

      const slotIds = res.body.data.slots.map((s) => s.id);
      expect(slotIds).toContain(slot62Id);
      expect(slotIds).not.toContain(slot67Id);

      // Verify every returned slot strictly belongs to doctor 62
      for (const slot of res.body.data.slots) {
        expect(String(slot.doctor_id)).toBe('62');
      }

      // Clean up test slots
      await pool.query('DELETE FROM availability_slots WHERE id IN ($1, $2)', [slot62Id, slot67Id]);
    });

    it('should reject invalid doctorId on /api/availability/doctor/:doctorId with HTTP 400', async () => {
      const resAlpha = await request(app).get('/api/availability/doctor/invalidDoctorId');
      expect(resAlpha.statusCode).toBe(400);
      expect(resAlpha.body.success).toBe(false);

      const resNegative = await request(app).get('/api/availability/doctor/-5');
      expect(resNegative.statusCode).toBe(400);
      expect(resNegative.body.success).toBe(false);

      const resZero = await request(app).get('/api/availability/doctor/0');
      expect(resZero.statusCode).toBe(400);
      expect(resZero.body.success).toBe(false);

      const resFloat = await request(app).get('/api/availability/doctor/62.5');
      expect(resFloat.statusCode).toBe(400);
      expect(resFloat.body.success).toBe(false);
    });

    it('should ignore client-provided query parameters overriding doctorId in URL', async () => {
      const res = await request(app).get(`/api/availability/doctor/${doctor1.id}?doctor_id=${doctor2.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      for (const slot of res.body.data.slots) {
        expect(String(slot.doctor_id)).toBe(String(doctor1.id));
        expect(String(slot.doctor_id)).not.toBe(String(doctor2.id));
      }
    });

    it('should allow general availability listing /api/availability without doctor filter', async () => {
      const res = await request(app).get('/api/availability');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.slots)).toBe(true);
      expect(res.body.data.slots.some((s) => s.id === createdSlotId)).toBe(true);
    });

    it('should reject pagination with invalid limit and offset values with 400 Bad Request', async () => {
      const resLimit = await request(app).get('/api/availability?limit=-5');
      expect(resLimit.statusCode).toBe(400);

      const resLimitTooHigh = await request(app).get('/api/availability?limit=500');
      expect(resLimitTooHigh.statusCode).toBe(400);

      const resOffset = await request(app).get('/api/availability?offset=-1');
      expect(resOffset.statusCode).toBe(400);
    });

    it('should prevent Doctor 2 from viewing Doctor 1 non-available slots with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/availability?doctor_id=${doctor1.id}&status=booked`)
        .set('Authorization', `Bearer ${doctor2Token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should prevent Doctor 2 from modifying Doctor 1 slot with 403 Forbidden', async () => {
      const newStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .patch(`/api/availability/${createdSlotId}`)
        .set('Authorization', `Bearer ${doctor2Token}`)
        .send({
          start_time: newStart.toISOString(),
          end_time: newEnd.toISOString()
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/permission/i);
    });

    it('should reject empty update requests on availability with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/availability/${createdSlotId}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/editable field/i);
    });

    it('should prevent doctor from setting status: booked on generic update endpoint with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/availability/${createdSlotId}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ status: 'booked' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot manually mark/i);
    });

    it('should allow Doctor 1 to update their own slot', async () => {
      const newStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000);

      const res = await request(app)
        .patch(`/api/availability/${createdSlotId}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: newStart.toISOString(),
          end_time: newEnd.toISOString()
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slot.id).toBe(createdSlotId);
    });

    it('should prevent Doctor 2 from deleting Doctor 1 slot with 403 Forbidden', async () => {
      const res = await request(app)
        .delete(`/api/availability/${createdSlotId}`)
        .set('Authorization', `Bearer ${doctor2Token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should allow Doctor 1 to delete an unbooked slot', async () => {
      const tempStart = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
      const tempEnd = new Date(tempStart.getTime() + 45 * 60 * 1000);

      const createRes = await request(app)
        .post('/api/availability')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: tempStart.toISOString(),
          end_time: tempEnd.toISOString()
        });

      const tempId = createRes.body.data.slot.id;

      const deleteRes = await request(app)
        .delete(`/api/availability/${tempId}`)
        .set('Authorization', `Bearer ${doctor1Token}`);

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      const checkRes = await pool.query('SELECT * FROM availability_slots WHERE id = $1', [tempId]);
      expect(checkRes.rows.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. CONSULTATION BOOKING TESTS
  // =========================================================================
  describe('Consultation Booking (/api/consultations)', () => {
    let bookingSlot;
    let slotOffsetCounter = 1;

    beforeEach(async () => {
      const slotStart = new Date(Date.now() + (20 + slotOffsetCounter++) * 24 * 60 * 60 * 1000);
      const slotEnd = new Date(slotStart.getTime() + 45 * 60 * 1000);

      const res = await pool.query(`
        INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
        VALUES ($1, $2, $3, 'available')
        RETURNING id, doctor_id, start_time, end_time, status;
      `, [doctor1.id, slotStart.toISOString(), slotEnd.toISOString()]);
      bookingSlot = res.rows[0];
    });

    it('should reject unauthenticated booking requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/consultations')
        .send({ availability_slot_id: bookingSlot.id });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject booking requests with invalid or missing availability_slot_id with 400', async () => {
      const resMissing = await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({});
      expect(resMissing.statusCode).toBe(400);

      const resInvalid = await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ availability_slot_id: 'not-an-id' });
      expect(resInvalid.statusCode).toBe(400);
    });

    it('should reject booking requests from doctors with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ availability_slot_id: bookingSlot.id });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should allow an active patient to successfully book an available slot', async () => {
      const res = await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          availability_slot_id: bookingSlot.id,
          doctor_id: doctor1.id,
          notes: 'Experiencing Vata imbalance and insomnia'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.consultation).toBeDefined();
      expect(res.body.data.consultation.booking_reference).toMatch(/^CON-/);
      expect(res.body.data.consultation.status).toBe('booked');
      expect(parseInt(res.body.data.consultation.patient_id, 10)).toBe(parseInt(patient1User.id, 10));

      const slotCheck = await pool.query('SELECT status FROM availability_slots WHERE id = $1', [bookingSlot.id]);
      expect(slotCheck.rows[0].status).toBe('booked');
    });

    it('should prevent a second patient from booking the same slot with 409 Conflict', async () => {
      await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ availability_slot_id: bookingSlot.id });

      const res = await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient2Token}`)
        .send({ availability_slot_id: bookingSlot.id });

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already booked/i);
    });

    it('should prevent inactive patient accounts from booking consultations with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${inactivePatientToken}`)
        .send({ availability_slot_id: bookingSlot.id });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/active/i);
    });

    it('should prevent doctors from modifying an already booked availability slot with 409 Conflict', async () => {
      await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ availability_slot_id: bookingSlot.id });

      const res = await request(app)
        .patch(`/api/availability/${bookingSlot.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          start_time: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString()
        });

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already booked/i);
    });

    it('should prevent doctors from deleting an already booked availability slot with 409 Conflict', async () => {
      await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ availability_slot_id: bookingSlot.id });

      const res = await request(app)
        .delete(`/api/availability/${bookingSlot.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`);

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already booked/i);
    });

    it('should safely handle concurrent booking attempts for the same slot (only ONE succeeds)', async () => {
      const raceSlotStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const raceSlotEnd = new Date(raceSlotStart.getTime() + 30 * 60 * 1000);
      const slotRes = await pool.query(`
        INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
        VALUES ($1, $2, $3, 'available')
        RETURNING id;
      `, [doctor1.id, raceSlotStart.toISOString(), raceSlotEnd.toISOString()]);
      const raceSlotId = slotRes.rows[0].id;

      const [req1, req2] = await Promise.all([
        request(app)
          .post('/api/consultations')
          .set('Authorization', `Bearer ${patient1Token}`)
          .send({ availability_slot_id: raceSlotId }),
        request(app)
          .post('/api/consultations')
          .set('Authorization', `Bearer ${patient2Token}`)
          .send({ availability_slot_id: raceSlotId })
      ]);

      const statusCodes = [req1.statusCode, req2.statusCode];
      expect(statusCodes).toContain(201);
      expect(statusCodes).toContain(409);

      const countRes = await pool.query('SELECT COUNT(*) FROM consultations WHERE availability_slot_id = $1', [raceSlotId]);
      expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
    });

    it('should safely handle simultaneous booking vs slot deletion (row locking serializes them)', async () => {
      const raceStart = new Date(Date.now() + 250 * 24 * 60 * 60 * 1000);
      const raceEnd = new Date(raceStart.getTime() + 30 * 60 * 1000);
      const slotRes = await pool.query(`
        INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
        VALUES ($1, $2, $3, 'available')
        RETURNING id;
      `, [doctor1.id, raceStart.toISOString(), raceEnd.toISOString()]);
      const targetSlotId = slotRes.rows[0].id;

      const [bookRes, delRes] = await Promise.all([
        request(app)
          .post('/api/consultations')
          .set('Authorization', `Bearer ${patient1Token}`)
          .send({ availability_slot_id: targetSlotId }),
        request(app)
          .delete(`/api/availability/${targetSlotId}`)
          .set('Authorization', `Bearer ${doctor1Token}`)
      ]);

      if (bookRes.statusCode === 201) {
        expect(delRes.statusCode).toBe(409);
      } else {
        expect(delRes.statusCode).toBe(200);
        expect(bookRes.statusCode).toBe(404);
      }
    });

    it('should roll back transaction cleanly on failed booking without creating orphaned consultation or modifying slot', async () => {
      const initialSlotRes = await pool.query('SELECT status FROM availability_slots WHERE id = $1', [bookingSlot.id]);
      expect(initialSlotRes.rows[0].status).toBe('available');

      const res = await request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          availability_slot_id: bookingSlot.id,
          doctor_id: 999999
        });

      expect(res.statusCode).toBe(400);

      const postSlotRes = await pool.query('SELECT status FROM availability_slots WHERE id = $1', [bookingSlot.id]);
      expect(postSlotRes.rows[0].status).toBe('available');

      const conCount = await pool.query('SELECT COUNT(*) FROM consultations WHERE availability_slot_id = $1', [bookingSlot.id]);
      expect(parseInt(conCount.rows[0].count, 10)).toBe(0);
    });
  });

  // =========================================================================
  // 3. CONSULTATION ACCESS & CANCELLATION TESTS
  // =========================================================================
  describe('Consultation Access & Cancellation (/api/consultations)', () => {
    let testConsultation;
    let testSlotId;
    let cancelSlotOffset = 1;

    beforeEach(async () => {
      const start = new Date(Date.now() + (50 + cancelSlotOffset++) * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 45 * 60 * 1000);

      const slotRes = await pool.query(`
        INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
        VALUES ($1, $2, $3, 'booked')
        RETURNING id;
      `, [doctor1.id, start.toISOString(), end.toISOString()]);
      testSlotId = slotRes.rows[0].id;

      const conRes = await pool.query(`
        INSERT INTO consultations (patient_id, doctor_id, availability_slot_id, booking_reference, status, notes)
        VALUES ($1, $2, $3, $4, 'booked', 'Test consultation notes')
        RETURNING id, patient_id, doctor_id, availability_slot_id, booking_reference, status;
      `, [patient1User.id, doctor1.id, testSlotId, `TEST-${Date.now()}-${Math.random()}`]);
      testConsultation = conRes.rows[0];
    });

    it('should reject unauthenticated consultation access requests with 401 Unauthorized', async () => {
      const res = await request(app).get(`/api/consultations/${testConsultation.id}`);
      expect(res.statusCode).toBe(401);
    });

    it('should allow Patient 1 to view their own consultation details', async () => {
      const res = await request(app)
        .get(`/api/consultations/${testConsultation.id}`)
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.consultation.id).toBe(testConsultation.id);
      expect(res.body.data.consultation.doctor_name).toBe(doctor1User.name);
      expect(res.body.data.consultation.patient_name).toBe(patient1User.name);
    });

    it('should prevent Patient 2 from viewing Patient 1 consultation with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/consultations/${testConsultation.id}`)
        .set('Authorization', `Bearer ${patient2Token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/permission/i);
    });

    it('should allow assigned Doctor 1 to view the consultation', async () => {
      const res = await request(app)
        .get(`/api/consultations/${testConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.consultation.id).toBe(testConsultation.id);
    });

    it('should allow Administrator to view any consultation details', async () => {
      const res = await request(app)
        .get(`/api/consultations/${testConsultation.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.consultation.id).toBe(testConsultation.id);
    });

    it('should prevent unassigned Doctor 2 from viewing the consultation with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/consultations/${testConsultation.id}`)
        .set('Authorization', `Bearer ${doctor2Token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/permission/i);
    });

    it('should reject invalid pagination parameters on consultation listing with 400 Bad Request', async () => {
      const resLimit = await request(app)
        .get('/api/consultations?limit=-1')
        .set('Authorization', `Bearer ${patient1Token}`);
      expect(resLimit.statusCode).toBe(400);

      const resOffset = await request(app)
        .get('/api/consultations?offset=-5')
        .set('Authorization', `Bearer ${patient1Token}`);
      expect(resOffset.statusCode).toBe(400);

      const resStatus = await request(app)
        .get('/api/consultations?status=invalid_status')
        .set('Authorization', `Bearer ${patient1Token}`);
      expect(resStatus.statusCode).toBe(400);
    });

    it('should allow patient to list their own consultations', async () => {
      const res = await request(app)
        .get('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.consultations)).toBe(true);
      expect(res.body.data.consultations.some((c) => c.id === testConsultation.id)).toBe(true);
    });

    it('should allow patient to cancel an eligible booking and release the availability slot', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${testConsultation.id}/cancel`)
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.consultation.status).toBe('cancelled');

      const slotCheck = await pool.query('SELECT status FROM availability_slots WHERE id = $1', [testSlotId]);
      expect(slotCheck.rows[0].status).toBe('available');
    });

    it('should allow assigned doctor to cancel the consultation and release the slot', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${testConsultation.id}/cancel`)
        .set('Authorization', `Bearer ${doctor1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.consultation.status).toBe('cancelled');

      const slotCheck = await pool.query('SELECT status FROM availability_slots WHERE id = $1', [testSlotId]);
      expect(slotCheck.rows[0].status).toBe('available');
    });

    it('should prevent Patient 2 from cancelling Patient 1 consultation with 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${testConsultation.id}/cancel`)
        .set('Authorization', `Bearer ${patient2Token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/permission/i);
    });

    it('should reject cancellation of an already cancelled consultation with 400 Bad Request', async () => {
      await request(app)
        .patch(`/api/consultations/${testConsultation.id}/cancel`)
        .set('Authorization', `Bearer ${patient1Token}`);

      const res = await request(app)
        .patch(`/api/consultations/${testConsultation.id}/cancel`)
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already cancelled/i);
    });

    it('should reject cancellation of an already completed consultation with 400 Bad Request', async () => {
      await pool.query("UPDATE consultations SET status = 'completed' WHERE id = $1", [testConsultation.id]);

      const res = await request(app)
        .patch(`/api/consultations/${testConsultation.id}/cancel`)
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/completed/i);
    });

    it('should reject cancellation of an in_progress consultation with 400 Bad Request', async () => {
      await pool.query("UPDATE consultations SET status = 'in_progress' WHERE id = $1", [testConsultation.id]);

      const res = await request(app)
        .patch(`/api/consultations/${testConsultation.id}/cancel`)
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/in progress/i);
    });

    it('should safely handle concurrent cancellation and simultaneous re-booking of the same slot', async () => {
      const [cancelRes, bookRes] = await Promise.all([
        request(app)
          .patch(`/api/consultations/${testConsultation.id}/cancel`)
          .set('Authorization', `Bearer ${patient1Token}`),
        request(app)
          .post('/api/consultations')
          .set('Authorization', `Bearer ${patient2Token}`)
          .send({ availability_slot_id: testSlotId })
      ]);

      expect(cancelRes.statusCode).toBe(200);
      expect([201, 409]).toContain(bookRes.statusCode);

      const activeCount = await pool.query(
        "SELECT COUNT(*) FROM consultations WHERE availability_slot_id = $1 AND status != 'cancelled'",
        [testSlotId]
      );
      expect(parseInt(activeCount.rows[0].count, 10)).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // 4. CONSULTATION LIFECYCLE MANAGEMENT TESTS (PATCH /:id)
  // =========================================================================
  describe('Consultation Lifecycle Management (/api/consultations/:id)', () => {
    let lifecycleConsultation;
    let lifecycleSlotOffset = 1;

    beforeEach(async () => {
      const start = new Date(Date.now() + (80 + lifecycleSlotOffset++) * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 30 * 60 * 1000);

      const slotRes = await pool.query(`
        INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
        VALUES ($1, $2, $3, 'booked')
        RETURNING id;
      `, [doctor1.id, start.toISOString(), end.toISOString()]);

      const conRes = await pool.query(`
        INSERT INTO consultations (patient_id, doctor_id, availability_slot_id, booking_reference, status, notes)
        VALUES ($1, $2, $3, $4, 'booked', 'Lifecycle test')
        RETURNING id, patient_id, doctor_id, availability_slot_id, booking_reference, status;
      `, [patient1User.id, doctor1.id, slotRes.rows[0].id, `LC-${Date.now()}-${Math.random()}`]);
      lifecycleConsultation = conRes.rows[0];
    });

    it('should reject unauthenticated lifecycle update requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .send({ status: 'in_progress' });

      expect(res.statusCode).toBe(401);
    });

    it('should reject lifecycle updates from patients with 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ status: 'in_progress' });

      expect(res.statusCode).toBe(403);
    });

    it('should reject unassigned doctor from updating consultation lifecycle with 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor2Token}`)
        .send({ status: 'in_progress' });

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/permission/i);
    });

    it('should reject empty update requests on consultation lifecycle with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/editable field/i);
    });

    it('should reject invalid consultation status with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ status: 'invalid_status_xyz' });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/invalid consultation status/i);
    });

    it('should reject contradictory timestamps when started_at is after ended_at with 400 Bad Request', async () => {
      const now = Date.now();
      const res = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          started_at: new Date(now + 60000).toISOString(),
          ended_at: new Date(now).toISOString()
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/started_at must be earlier/i);
    });

    it('should allow assigned doctor to transition status from booked to in_progress', async () => {
      const res = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          status: 'in_progress',
          started_at: new Date().toISOString()
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.consultation.status).toBe('in_progress');
    });

    it('should reject invalid status transition from in_progress back to booked with 400 Bad Request', async () => {
      // First update to in_progress
      await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ status: 'in_progress' });

      // Attempt to move backwards to booked
      const res = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ status: 'booked' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid status transition/i);
    });

    it('should allow assigned doctor to complete consultation and reject any further modifications', async () => {
      // Move to in_progress then completed
      await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ status: 'in_progress' });

      const resComplete = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          status: 'completed',
          ended_at: new Date().toISOString()
        });

      expect(resComplete.statusCode).toBe(200);
      expect(resComplete.body.data.consultation.status).toBe('completed');

      // Attempt to update completed consultation
      const resAfter = await request(app)
        .patch(`/api/consultations/${lifecycleConsultation.id}`)
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({ notes: 'Trying to modify completed' });

      expect(resAfter.statusCode).toBe(400);
      expect(resAfter.body.message).toMatch(/already completed/i);
    });
  });

  // =========================================================================
  // 5. DATABASE SCHEMA & MIGRATION VALIDATION
  // =========================================================================
  describe('Database Schema & Migration Validation', () => {
    it('should confirm schema_migrations contains exactly the expected migrations in order', async () => {
      const res = await pool.query('SELECT name FROM schema_migrations ORDER BY id ASC');
      const migrationNames = res.rows.map((r) => r.name);

      expect(migrationNames).toEqual([
        '001_create_users_and_profiles.sql',
        '002_create_doctors_and_availability.sql',
        '003_create_consultations_and_prescriptions.sql',
        '004_create_payments_and_audit_logs.sql',
        '005_add_availability_slot_exclusion_constraint.sql',
        '006_create_refresh_tokens.sql',
        '007_create_idempotency_keys.sql'
      ]);
    });

    it('should reject overlapping slot inserts at the database engine level via exclusion constraint', async () => {
      const start1 = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
      const end1 = new Date(start1.getTime() + 60 * 60 * 1000);

      await pool.query(`
        INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
        VALUES ($1, $2, $3, 'available');
      `, [doctor1.id, start1.toISOString(), end1.toISOString()]);

      const overlapStart = new Date(start1.getTime() + 30 * 60 * 1000);
      const overlapEnd = new Date(start1.getTime() + 90 * 60 * 1000);

      let dbError;
      try {
        await pool.query(`
          INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
          VALUES ($1, $2, $3, 'available');
        `, [doctor1.id, overlapStart.toISOString(), overlapEnd.toISOString()]);
      } catch (err) {
        dbError = err;
      }

      expect(dbError).toBeDefined();
      expect(dbError.code).toBe('23P01'); // PostgreSQL exclusion_violation
    });
  });

  // =========================================================================
  // 6. DOCTOR PROFILE & CREDENTIALS MANAGEMENT
  // =========================================================================
  describe('Doctor Profile Management (/api/doctors)', () => {
    it('should return verified doctors in public list with both id and user_id', async () => {
      const res = await request(app).get('/api/doctors');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.doctors)).toBe(true);

      const matchedDoctor = res.body.data.doctors.find((d) => d.id === doctor1.id);
      expect(matchedDoctor).toBeDefined();
      expect(matchedDoctor.id).toBe(doctor1.id);
      expect(matchedDoctor.user_id).toBe(doctor1User.id);
    });

    it('should return doctor details by doctor id with both id and user_id', async () => {
      const res = await request(app).get(`/api/doctors/${doctor1.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.doctor.id).toBe(doctor1.id);
      expect(res.body.data.doctor.user_id).toBe(doctor1User.id);
    });

    it('should prevent patients from modifying doctor profiles with 403 Forbidden', async () => {
      const res = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          specialization: 'Fake Specialization',
          qualification: 'Fake Qualification',
          experience_years: 5,
          consultation_fee: 500
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should allow authenticated doctor to update their own professional credentials', async () => {
      const res = await request(app)
        .put('/api/doctors/profile')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          specialization: 'Ayurveda Specialist & Panchakarma',
          qualification: 'BAMS, MD (Ayurveda), PhD',
          experience_years: 14,
          consultation_fee: 750,
          bio: 'Updated doctor bio for clinical practice'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.doctor.consultation_fee).toBe('750.00');
      expect(res.body.data.doctor.id).toBe(doctor1.id);
      expect(res.body.data.doctor.user_id).toBe(doctor1User.id);
    });
  });

  // =========================================================================
  // 7. PRESCRIPTION MANAGEMENT & AUTHORIZATION
  // =========================================================================
  describe('Prescription Management (/api/prescriptions)', () => {
    let prescConsultation;
    let createdPrescriptionId;

    beforeAll(async () => {
      const pStart = new Date(Date.now() + 140 * 24 * 60 * 60 * 1000);
      const pEnd = new Date(pStart.getTime() + 30 * 60 * 1000);

      const slotRes = await pool.query(`
        INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
        VALUES ($1, $2, $3, 'booked')
        RETURNING id;
      `, [doctor1.id, pStart.toISOString(), pEnd.toISOString()]);

      const conRes = await pool.query(`
        INSERT INTO consultations (patient_id, doctor_id, availability_slot_id, booking_reference, status, notes)
        VALUES ($1, $2, $3, $4, 'completed', 'Prescription test consultation')
        RETURNING id, patient_id, doctor_id, availability_slot_id;
      `, [patient1User.id, doctor1.id, slotRes.rows[0].id, `RXCON-${Date.now()}`]);
      prescConsultation = conRes.rows[0];
    });

    it('should reject prescription creation from patients with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          consultation_id: prescConsultation.id,
          prescription_details: { medicines: [{ name: 'Ashwagandha', dosage: '500mg' }] },
          notes: 'Patient attempt'
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject prescription creation from unassigned doctor with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${doctor2Token}`)
        .send({
          consultation_id: prescConsultation.id,
          prescription_details: { medicines: [{ name: 'Brahmi', dosage: '250mg' }] },
          notes: 'Unassigned doctor attempt'
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/assigned to you/i);
    });

    it('should allow assigned doctor to issue a prescription for the consultation', async () => {
      const res = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${doctor1Token}`)
        .send({
          consultation_id: prescConsultation.id,
          prescription_details: {
            medicines: [
              { name: 'Triphala Churna', dosage: '1 tsp before bed', duration: '14 days' },
              { name: 'Ashwagandha Tablet', dosage: '1 tablet twice daily', duration: '30 days' }
            ],
            dietary_advice: 'Avoid spicy and fermented foods'
          },
          notes: 'Follow up in 2 weeks'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.prescription).toBeDefined();
      expect(parseInt(res.body.data.prescription.consultation_id, 10)).toBe(parseInt(prescConsultation.id, 10));

      createdPrescriptionId = res.body.data.prescription.id;
    });

    it('should allow patient to view their own prescription details', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/${createdPrescriptionId}`)
        .set('Authorization', `Bearer ${patient1Token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.prescription.id).toBe(createdPrescriptionId);
    });

    it('should prevent Patient 2 from viewing Patient 1 prescription with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/${createdPrescriptionId}`)
        .set('Authorization', `Bearer ${patient2Token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/permission/i);
    });
  });

  // =========================================================================
  // 8. PAYMENT PROCESSING & OWNERSHIP
  // =========================================================================
  describe('Payment Processing (/api/payments)', () => {
    let payConsultation;

    beforeAll(async () => {
      const payStart = new Date(Date.now() + 150 * 24 * 60 * 60 * 1000);
      const payEnd = new Date(payStart.getTime() + 30 * 60 * 1000);

      const slotRes = await pool.query(`
        INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
        VALUES ($1, $2, $3, 'booked')
        RETURNING id;
      `, [doctor1.id, payStart.toISOString(), payEnd.toISOString()]);

      const conRes = await pool.query(`
        INSERT INTO consultations (patient_id, doctor_id, availability_slot_id, booking_reference, status, notes)
        VALUES ($1, $2, $3, $4, 'booked', 'Payment test consultation')
        RETURNING id, patient_id, doctor_id, availability_slot_id;
      `, [patient1User.id, doctor1.id, slotRes.rows[0].id, `PAYCON-${Date.now()}`]);
      payConsultation = conRes.rows[0];
    });

    it('should reject payment recording from unauthenticated client with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/payments')
        .send({ consultation_id: payConsultation.id });

      expect(res.statusCode).toBe(401);
    });

    it('should prevent Patient 2 from paying for Patient 1 consultation with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${patient2Token}`)
        .send({
          consultation_id: payConsultation.id,
          amount: 600,
          currency: 'INR'
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/another patient/i);
    });

    it('should allow owning patient to record a successful payment', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          consultation_id: payConsultation.id,
          amount: 600,
          currency: 'INR',
          status: 'completed',
          provider_reference: 'MOCK_PG_TXN_987654'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.payment.status).toBe('completed');
    });

    it('should prevent duplicate payments on an already paid consultation with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          consultation_id: payConsultation.id,
          amount: 600,
          currency: 'INR'
        });

      expect(res.statusCode).toBe(409);
      expect(res.body.message).toMatch(/already paid/i);
    });

    it('should prevent Patient 2 from viewing Patient 1 payment record with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/payments/consultation/${payConsultation.id}`)
        .set('Authorization', `Bearer ${patient2Token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/permission/i);
    });
  });
});
