require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_automated_testing_12345';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool } = require('../../src/config/db');

describe('Consultation Booking Idempotency (/api/consultations)', () => {
  const JWT_SECRET = process.env.JWT_SECRET;

  let doctorUser, doctor;
  let patient1User, patient2User;
  let doctorToken, patient1Token, patient2Token;

  const cleanupTestData = async () => {
    await pool.query(`
      DELETE FROM idempotency_keys
      WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE '%@idempotencytest.example.com'
      );
    `);
    await pool.query(`
      DELETE FROM audit_logs
      WHERE actor_user_id IN (
        SELECT id FROM users WHERE email LIKE '%@idempotencytest.example.com'
      );
    `);
    await pool.query(`
      DELETE FROM consultations
      WHERE patient_id IN (
        SELECT id FROM users WHERE email LIKE '%@idempotencytest.example.com'
      ) OR doctor_id IN (
        SELECT id FROM doctors WHERE user_id IN (
          SELECT id FROM users WHERE email LIKE '%@idempotencytest.example.com'
        )
      );
    `);
    await pool.query(`
      DELETE FROM availability_slots
      WHERE doctor_id IN (
        SELECT id FROM doctors WHERE user_id IN (
          SELECT id FROM users WHERE email LIKE '%@idempotencytest.example.com'
        )
      );
    `);
    await pool.query(`
      DELETE FROM doctors
      WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE '%@idempotencytest.example.com'
      );
    `);
    await pool.query(`
      DELETE FROM users
      WHERE email LIKE '%@idempotencytest.example.com';
    `);
  };

  beforeAll(async () => {
    await cleanupTestData();

    // Create Doctor
    const docUserRes = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Dr. Idemp Ayur', 'dr.idemp@idempotencytest.example.com', '$2a$10$FakeHashForTestingOnly123', 'doctor', 'active')
      RETURNING id, name, email, role, status;
    `);
    doctorUser = docUserRes.rows[0];

    const docProfileRes = await pool.query(`
      INSERT INTO doctors (user_id, specialization, qualification, experience_years, consultation_fee, verification_status)
      VALUES ($1, 'Panchakarma', 'BAMS, MD', 10, 500.00, 'verified')
      RETURNING id, user_id, specialization;
    `, [doctorUser.id]);
    doctor = docProfileRes.rows[0];

    // Create Patient 1
    const p1Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Patient One', 'patient1@idempotencytest.example.com', '$2a$10$FakeHashForTestingOnly123', 'patient', 'active')
      RETURNING id, name, email, role, status;
    `);
    patient1User = p1Res.rows[0];

    // Create Patient 2
    const p2Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('Patient Two', 'patient2@idempotencytest.example.com', '$2a$10$FakeHashForTestingOnly123', 'patient', 'active')
      RETURNING id, name, email, role, status;
    `);
    patient2User = p2Res.rows[0];

    // Create JWT tokens
    doctorToken = jwt.sign({ id: doctorUser.id, role: 'doctor' }, JWT_SECRET, { expiresIn: '1h' });
    patient1Token = jwt.sign({ id: patient1User.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });
    patient2Token = jwt.sign({ id: patient2User.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // Helper to create future available slots
  let slotDayCounter = 1;
  const createFutureSlot = async (hoursOffset = 0) => {
    const start = new Date(Date.now() + (30 + slotDayCounter++) * 24 * 60 * 60 * 1000 + hoursOffset * 3600000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const res = await pool.query(`
      INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
      VALUES ($1, $2, $3, 'available')
      RETURNING id, doctor_id, start_time, end_time, status;
    `, [doctor.id, start.toISOString(), end.toISOString()]);
    return res.rows[0];
  };

  it('1. A first booking with an idempotency key succeeds', async () => {
    const slot = await createFutureSlot();
    const idempotencyKey = `idemp-key-first-${Date.now()}`;

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        availability_slot_id: slot.id,
        doctor_id: doctor.id,
        notes: 'Initial booking for chronic back pain'
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.consultation).toBeDefined();
    expect(res.body.data.consultation.booking_reference).toMatch(/^CON-/);
    expect(res.headers['idempotent-replayed']).toBeUndefined();

    // Verify record in idempotency_keys table
    const idempRow = await pool.query(
      'SELECT * FROM idempotency_keys WHERE user_id = $1 AND operation = $2 AND key = $3',
      [patient1User.id, 'book_consultation', idempotencyKey]
    );
    expect(idempRow.rows.length).toBe(1);
    expect(idempRow.rows[0].status).toBe('completed');
    expect(idempRow.rows[0].response_code).toBe(201);
  });

  it('2. Retrying with the same key and payload returns the original response and Idempotent-Replayed header', async () => {
    const slot = await createFutureSlot();
    const idempotencyKey = `idemp-key-retry-${Date.now()}`;

    // First request
    const firstRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        availability_slot_id: slot.id,
        doctor_id: doctor.id,
        notes: 'Consultation for joint wellness'
      });

    expect(firstRes.statusCode).toBe(201);
    const originalBookingRef = firstRes.body.data.consultation.booking_reference;
    const originalConsultationId = firstRes.body.data.consultation.id;

    // Retry with exact same key and payload
    const retryRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        availability_slot_id: slot.id,
        doctor_id: doctor.id,
        notes: 'Consultation for joint wellness'
      });

    expect(retryRes.statusCode).toBe(201);
    expect(retryRes.headers['idempotent-replayed']).toBe('true');
    expect(retryRes.body.data.consultation.id).toBe(originalConsultationId);
    expect(retryRes.body.data.consultation.booking_reference).toBe(originalBookingRef);
    expect(retryRes.body).toEqual(firstRes.body);

    // Verify only ONE consultation was created for this slot in the database
    const countRes = await pool.query(
      'SELECT COUNT(*) FROM consultations WHERE availability_slot_id = $1',
      [slot.id]
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });

  it('3. Reusing an existing key with a different payload returns HTTP 422 Unprocessable Entity', async () => {
    const slotA = await createFutureSlot();
    const slotB = await createFutureSlot();
    const idempotencyKey = `idemp-key-conflict-${Date.now()}`;

    // Original booking for slotA
    const firstRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        availability_slot_id: slotA.id,
        doctor_id: doctor.id,
        notes: 'Original note'
      });
    expect(firstRes.statusCode).toBe(201);

    // Reuse key with different slot (payload tampering / mismatch)
    const mismatchSlotRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        availability_slot_id: slotB.id,
        doctor_id: doctor.id,
        notes: 'Original note'
      });

    expect(mismatchSlotRes.statusCode).toBe(422);
    expect(mismatchSlotRes.body.success).toBe(false);
    expect(mismatchSlotRes.body.message).toMatch(/different request payload/i);

    // Reuse key with different notes
    const mismatchNotesRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        availability_slot_id: slotA.id,
        doctor_id: doctor.id,
        notes: 'Completely different note'
      });

    expect(mismatchNotesRes.statusCode).toBe(422);
    expect(mismatchNotesRes.body.success).toBe(false);
    expect(mismatchNotesRes.body.message).toMatch(/different request payload/i);
  });

  it('4. Concurrent requests with the same key and payload do not create duplicate consultations', async () => {
    const slot = await createFutureSlot();
    const idempotencyKey = `idemp-key-concurrent-${Date.now()}`;

    const payload = {
      availability_slot_id: slot.id,
      doctor_id: doctor.id,
      notes: 'Concurrent test booking'
    };

    // Fire 2 simultaneous requests with the exact same key
    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
      request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
    ]);

    // Both should receive successful 201 responses
    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    // Both should point to the exact same booking reference
    const refA = resA.body.data.consultation.booking_reference;
    const refB = resB.body.data.consultation.booking_reference;
    expect(refA).toBe(refB);

    // Exactly one was the replay
    const replayedHeaders = [resA.headers['idempotent-replayed'], resB.headers['idempotent-replayed']];
    expect(replayedHeaders).toContain('true');

    // Confirm in the database: strictly ONE consultation was inserted
    const countRes = await pool.query(
      'SELECT COUNT(*) FROM consultations WHERE availability_slot_id = $1',
      [slot.id]
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });

  it('5. Concurrent requests with DIFFERENT keys cannot bypass existing slot-locking protections', async () => {
    const slot = await createFutureSlot();
    const keyA = `idemp-diff-A-${Date.now()}`;
    const keyB = `idemp-diff-B-${Date.now()}`;

    // Two patients compete for the same slot with different idempotency keys
    const [resPatient1, resPatient2] = await Promise.all([
      request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient1Token}`)
        .set('Idempotency-Key', keyA)
        .send({ availability_slot_id: slot.id, doctor_id: doctor.id }),
      request(app)
        .post('/api/consultations')
        .set('Authorization', `Bearer ${patient2Token}`)
        .set('Idempotency-Key', keyB)
        .send({ availability_slot_id: slot.id, doctor_id: doctor.id })
    ]);

    const statusCodes = [resPatient1.statusCode, resPatient2.statusCode];
    expect(statusCodes).toContain(201);
    expect(statusCodes).toContain(409);

    // Confirm in database that only ONE consultation was created
    const countRes = await pool.query(
      'SELECT COUNT(*) FROM consultations WHERE availability_slot_id = $1',
      [slot.id]
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });

  it('6. An error does not leave an unusable idempotency record (client can retry valid request)', async () => {
    // 1. Create a slot that has already passed (invalid for booking)
    const pastStart = new Date(Date.now() - 48 * 3600000);
    const pastEnd = new Date(pastStart.getTime() + 1800000);
    const pastSlotRes = await pool.query(`
      INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
      VALUES ($1, $2, $3, 'available')
      RETURNING id;
    `, [doctor.id, pastStart.toISOString(), pastEnd.toISOString()]);
    const pastSlotId = pastSlotRes.rows[0].id;

    const failedKey = `idemp-fail-key-${Date.now()}`;

    // Booking attempt on past slot fails with 400
    const failRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', failedKey)
      .send({ availability_slot_id: pastSlotId });

    expect(failRes.statusCode).toBe(400);

    // Verify no idempotency record was committed in 'processing' or 'completed' state
    const idempCheck = await pool.query(
      'SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2',
      [patient1User.id, failedKey]
    );
    expect(idempCheck.rows.length).toBe(0);

    // Client can now retry with the same key on a valid future slot
    const validFutureSlot = await createFutureSlot();
    const successRes = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', failedKey)
      .send({ availability_slot_id: validFutureSlot.id });

    expect(successRes.statusCode).toBe(201);
    expect(successRes.body.success).toBe(true);
  });

  it('7. Requests without an Idempotency-Key header succeed and remain backward compatible', async () => {
    const slot = await createFutureSlot();

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({ availability_slot_id: slot.id });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
  });

  it('8. Rejects invalid Idempotency-Key header with 400 Bad Request', async () => {
    const slot = await createFutureSlot();

    // Empty key
    const resEmpty = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', '   ')
      .send({ availability_slot_id: slot.id });

    expect(resEmpty.statusCode).toBe(400);
    expect(resEmpty.body.message).toMatch(/invalid idempotency-key/i);

    // Key exceeding 255 characters
    const longKey = 'a'.repeat(256);
    const resLong = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', longKey)
      .send({ availability_slot_id: slot.id });

    expect(resLong.statusCode).toBe(400);
    expect(resLong.body.message).toMatch(/invalid idempotency-key/i);
  });

  it('9. Scopes keys to the authenticated user so Patient 2 cannot access or collide with Patient 1 key', async () => {
    const slot1 = await createFutureSlot();
    const slot2 = await createFutureSlot();
    const sharedKeyName = `shared-key-name-${Date.now()}`;

    // Patient 1 books slot1 with sharedKeyName
    const resP1 = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', sharedKeyName)
      .send({ availability_slot_id: slot1.id, doctor_id: doctor.id });

    expect(resP1.statusCode).toBe(201);
    const bookingRefP1 = resP1.body.data.consultation.booking_reference;

    // Patient 2 uses the SAME key name for their own booking on slot2
    const resP2 = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${patient2Token}`)
      .set('Idempotency-Key', sharedKeyName)
      .send({ availability_slot_id: slot2.id, doctor_id: doctor.id });

    expect(resP2.statusCode).toBe(201);
    const bookingRefP2 = resP2.body.data.consultation.booking_reference;

    // Both bookings succeeded with distinct references
    expect(bookingRefP1).not.toBe(bookingRefP2);
    expect(resP2.headers['idempotent-replayed']).toBeUndefined();
  });
});
