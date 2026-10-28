const { pool } = require('../config/db');

const createBookingConsultation = async (dbExecutor, { patientId, doctorId, slotId, bookingReference, notes }) => {
  const sql = `
    INSERT INTO consultations (patient_id, doctor_id, availability_slot_id, booking_reference, status, notes)
    VALUES ($1, $2, $3, $4, 'booked', $5)
    RETURNING id, patient_id, doctor_id, availability_slot_id, booking_reference, status, notes, created_at;
  `;
  const res = await dbExecutor.query(sql, [patientId, doctorId, slotId, bookingReference, notes]);
  return res.rows[0];
};

const getConsultationById = async (id) => {
  const sql = `
    SELECT 
      c.id, c.booking_reference, c.status, c.started_at, c.ended_at, c.notes, c.created_at, c.updated_at,
      c.patient_id, u_patient.name AS patient_name, u_patient.email AS patient_email,
      c.doctor_id, d.user_id AS doctor_user_id, u_doctor.name AS doctor_name, u_doctor.email AS doctor_email,
      d.specialization, d.consultation_fee,
      s.id AS slot_id, s.start_time, s.end_time
    FROM consultations c
    JOIN users u_patient ON c.patient_id = u_patient.id
    JOIN doctors d ON c.doctor_id = d.id
    JOIN users u_doctor ON d.user_id = u_doctor.id
    JOIN availability_slots s ON c.availability_slot_id = s.id
    WHERE c.id = $1;
  `;
  const res = await pool.query(sql, [id]);
  return res.rows[0] || null;
};

const listUserConsultations = async ({ userId, role = 'patient', status, fromDate, toDate, limit = 50, offset = 0 } = {}) => {
  const params = [];
  const whereClauses = [];

  if (role === 'patient') {
    params.push(userId);
    whereClauses.push(`c.patient_id = $${params.length}`);
  } else if (role === 'doctor') {
    params.push(userId);
    whereClauses.push(`c.doctor_id = (SELECT id FROM doctors WHERE user_id = $${params.length})`);
  }
  // If role is 'admin', do not restrict by user ID to allow administrative oversight

  if (status) {
    params.push(status);
    whereClauses.push(`c.status = $${params.length}`);
  }

  if (fromDate) {
    params.push(fromDate);
    whereClauses.push(`s.start_time >= $${params.length}`);
  }

  if (toDate) {
    params.push(toDate);
    whereClauses.push(`s.end_time <= $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const wherePart = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `
    SELECT 
      c.id, c.booking_reference, c.status, c.started_at, c.ended_at, c.notes, c.created_at,
      c.patient_id, u_patient.name AS patient_name,
      c.doctor_id, u_doctor.name AS doctor_name, d.specialization, d.consultation_fee,
      s.id AS slot_id, s.start_time, s.end_time
    FROM consultations c
    JOIN users u_patient ON c.patient_id = u_patient.id
    JOIN doctors d ON c.doctor_id = d.id
    JOIN users u_doctor ON d.user_id = u_doctor.id
    JOIN availability_slots s ON c.availability_slot_id = s.id
    ${wherePart}
    ORDER BY s.start_time DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx};
  `;
  const res = await pool.query(sql, params);
  return res.rows;
};

const lockConsultationForUpdate = async (client, id) => {
  const sql = `
    SELECT 
      c.id, c.patient_id, c.doctor_id, c.availability_slot_id, c.booking_reference, c.status,
      c.started_at, c.ended_at, c.notes,
      d.user_id AS doctor_user_id
    FROM consultations c
    JOIN doctors d ON c.doctor_id = d.id
    WHERE c.id = $1
    FOR UPDATE;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
};

const cancelConsultation = async (dbExecutor, id) => {
  const sql = `
    UPDATE consultations
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id, patient_id, doctor_id, availability_slot_id, booking_reference, status, updated_at;
  `;
  const res = await dbExecutor.query(sql, [id]);
  return res.rows[0] || null;
};

const updateConsultationLifecycle = async (dbExecutor, id, { status, startedAt, endedAt, notes }) => {
  const updates = [];
  const params = [];

  if (status !== undefined) {
    params.push(status);
    updates.push(`status = $${params.length}`);
  }
  if (startedAt !== undefined) {
    params.push(startedAt);
    updates.push(`started_at = $${params.length}`);
  }
  if (endedAt !== undefined) {
    params.push(endedAt);
    updates.push(`ended_at = $${params.length}`);
  }
  if (notes !== undefined) {
    params.push(notes);
    updates.push(`notes = $${params.length}`);
  }

  params.push(id);
  const idIdx = params.length;

  const sql = `
    UPDATE consultations
    SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${idIdx}
    RETURNING id, booking_reference, status, started_at, ended_at, notes, updated_at;
  `;
  const res = await dbExecutor.query(sql, params);
  return res.rows[0] || null;
};

module.exports = {
  createBookingConsultation,
  getConsultationById,
  listUserConsultations,
  lockConsultationForUpdate,
  cancelConsultation,
  updateConsultationLifecycle
};
