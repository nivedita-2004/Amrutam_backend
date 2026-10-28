const { pool } = require('../config/db');

const lockDoctorForSlotOperations = async (dbExecutor, doctorId) => {
  const sql = `
    SELECT id FROM doctors
    WHERE id = $1
    FOR UPDATE;
  `;
  const res = await dbExecutor.query(sql, [doctorId]);
  return res.rows[0] || null;
};

const createSlot = async (dbExecutor, doctorId, startTime, endTime) => {
  const sql = `
    INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
    VALUES ($1, $2, $3, 'available')
    RETURNING id, doctor_id, start_time, end_time, status, created_at;
  `;
  const res = await dbExecutor.query(sql, [doctorId, startTime, endTime]);
  return res.rows[0];
};

const findOverlappingSlot = async (dbExecutor, doctorId, startTime, endTime, excludeSlotId = null) => {
  const params = [doctorId, startTime, endTime];
  let sql = `
    SELECT id, doctor_id, start_time, end_time, status
    FROM availability_slots
    WHERE doctor_id = $1
      AND status != 'cancelled'
      AND start_time < $3::timestamptz
      AND end_time > $2::timestamptz
  `;

  if (excludeSlotId) {
    params.push(excludeSlotId);
    sql += ` AND id != $${params.length}`;
  }

  sql += ` LIMIT 1;`;

  const res = await dbExecutor.query(sql, params);
  return res.rows[0] || null;
};

const getSlotById = async (id) => {
  const sql = `
    SELECT 
      s.id, s.doctor_id, s.start_time, s.end_time, s.status, s.created_at, s.updated_at,
      d.user_id AS doctor_user_id, d.specialization, d.consultation_fee,
      u.name AS doctor_name, u.email AS doctor_email
    FROM availability_slots s
    JOIN doctors d ON s.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    WHERE s.id = $1;
  `;
  const res = await pool.query(sql, [id]);
  return res.rows[0] || null;
};

const listSlots = async ({ doctorId, fromDate, toDate, status = 'available', limit = 50, offset = 0 } = {}) => {
  const params = [];
  const whereClauses = [];

  if (doctorId !== undefined && doctorId !== null) {
    params.push(doctorId);
    whereClauses.push(`s.doctor_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    whereClauses.push(`s.status = $${params.length}`);
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
      s.id, s.doctor_id, s.start_time, s.end_time, s.status, s.created_at,
      d.specialization, d.consultation_fee,
      u.name AS doctor_name
    FROM availability_slots s
    JOIN doctors d ON s.doctor_id = d.id
    JOIN users u ON d.user_id = u.id
    ${wherePart}
    ORDER BY s.start_time ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx};
  `;

  const res = await pool.query(sql, params);
  return res.rows;
};

const lockSlotForBooking = async (client, slotId) => {
  const sql = `
    SELECT id, doctor_id, start_time, end_time, status
    FROM availability_slots
    WHERE id = $1
    FOR UPDATE;
  `;
  const res = await client.query(sql, [slotId]);
  return res.rows[0] || null;
};

const updateSlot = async (dbExecutor, slotId, { startTime, endTime, status }) => {
  const updates = [];
  const params = [];

  if (startTime) {
    params.push(startTime);
    updates.push(`start_time = $${params.length}`);
  }
  if (endTime) {
    params.push(endTime);
    updates.push(`end_time = $${params.length}`);
  }
  if (status) {
    params.push(status);
    updates.push(`status = $${params.length}`);
  }

  params.push(slotId);
  const idIdx = params.length;

  const sql = `
    UPDATE availability_slots
    SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${idIdx}
    RETURNING id, doctor_id, start_time, end_time, status, updated_at;
  `;

  const res = await dbExecutor.query(sql, params);
  return res.rows[0] || null;
};

const deleteSlot = async (dbExecutor, slotId) => {
  const sql = `
    DELETE FROM availability_slots
    WHERE id = $1
    RETURNING id, doctor_id, start_time, end_time;
  `;
  const res = await dbExecutor.query(sql, [slotId]);
  return res.rows[0] || null;
};

const updateSlotStatus = async (dbExecutor, slotId, status) => {
  const sql = `
    UPDATE availability_slots
    SET status = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, doctor_id, start_time, end_time, status;
  `;
  const res = await dbExecutor.query(sql, [status, slotId]);
  return res.rows[0];
};

module.exports = {
  lockDoctorForSlotOperations,
  createSlot,
  findOverlappingSlot,
  getSlotById,
  listSlots,
  lockSlotForBooking,
  updateSlot,
  deleteSlot,
  updateSlotStatus
};
