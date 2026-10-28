const crypto = require('crypto');
const { pool } = require('../config/db');
const consultationQuery = require('../query/consultation.query');
const availabilityQuery = require('../query/availability.query');
const auditQuery = require('../query/audit.query');
const idempotencyQuery = require('../query/idempotency.query');

const bookConsultation = async (req, res, next) => {
  const patientId = req.user.id;
  const { availability_slot_id, doctor_id, notes } = req.body;

  // Validate Idempotency-Key header if provided
  const rawIdempotencyKey = req.headers['idempotency-key'];
  let idempotencyKey = null;
  if (rawIdempotencyKey !== undefined) {
    if (typeof rawIdempotencyKey !== 'string' || !rawIdempotencyKey.trim() || rawIdempotencyKey.trim().length > 255) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Idempotency-Key header. Must be a non-empty string with maximum 255 characters.'
      });
    }
    idempotencyKey = rawIdempotencyKey.trim();
  }

  // Calculate deterministic request hash for idempotency comparison
  const normalizedPayload = {
    availability_slot_id: availability_slot_id !== undefined ? String(availability_slot_id).trim() : null,
    doctor_id: doctor_id !== undefined ? String(doctor_id).trim() : null,
    notes: notes !== undefined && notes !== null ? String(notes).trim() : null
  };
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(normalizedPayload)).digest('hex');
  const OPERATION = 'book_consultation';

  // Fast pre-check: if key exists and completed, replay cached response without opening transaction
  if (idempotencyKey) {
    const existing = await idempotencyQuery.getIdempotencyRecord(patientId, OPERATION, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        return res.status(422).json({
          success: false,
          message: 'Idempotency key reused with a different request payload'
        });
      }
      if (existing.status === 'completed') {
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(existing.response_code).json(existing.response_body);
      }
    }
  }

  // Validate availability_slot_id
  const slotId = parseInt(availability_slot_id, 10);
  if (!availability_slot_id || isNaN(slotId) || slotId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'availability_slot_id must be a valid positive integer'
    });
  }

  // Validate doctor_id if provided
  if (doctor_id !== undefined) {
    const parsedDocId = parseInt(doctor_id, 10);
    if (isNaN(parsedDocId) || parsedDocId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'doctor_id must be a valid positive integer'
      });
    }
  }

  // 1. Verify authenticated user is an active patient
  const userCheck = await pool.query('SELECT status, role FROM users WHERE id = $1', [patientId]);
  if (!userCheck.rows[0] || userCheck.rows[0].status !== 'active') {
    return res.status(403).json({
      success: false,
      message: 'Only active patient accounts can book consultations'
    });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // If idempotencyKey is provided, atomically insert a 'processing' record within the booking transaction
    if (idempotencyKey) {
      await idempotencyQuery.createProcessingRecord(client, {
        userId: patientId,
        operation: OPERATION,
        key: idempotencyKey,
        requestHash
      });
    }

    // 2. Lock the availability slot for update to avoid race conditions
    const slot = await availabilityQuery.lockSlotForBooking(client, slotId);
    if (!slot) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Availability slot not found'
      });
    }

    // 3. Verify slot is available
    if (slot.status !== 'available') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This availability slot is already booked or unavailable'
      });
    }

    // 4. Verify slot is in the future
    if (new Date(slot.start_time) <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Cannot book an availability slot in the past'
      });
    }

    // 5. If doctor_id is specified in request, ensure it matches slot's doctor
    if (doctor_id && parseInt(doctor_id, 10) !== parseInt(slot.doctor_id, 10)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Provided doctor_id does not match the availability slot'
      });
    }

    // 6. Mark slot as booked within transaction
    await availabilityQuery.updateSlotStatus(client, slotId, 'booked');

    // 7. Generate unique booking reference
    const bookingReference = `CON-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // 8. Create consultation record within transaction
    const consultation = await consultationQuery.createBookingConsultation(client, {
      patientId,
      doctorId: slot.doctor_id,
      slotId: slotId,
      bookingReference,
      notes: notes || null
    });

    await auditQuery.createAuditLog({
      actorUserId: patientId,
      action: 'CONSULTATION_BOOKED',
      entityType: 'consultation',
      entityId: consultation.id,
      requestId: req.id,
      metadata: {
        slotId,
        doctorId: slot.doctor_id,
        bookingReference,
        feeAmount: consultation.fee_amount
      }
    }, client);

    const responsePayload = {
      success: true,
      message: 'Consultation booked successfully',
      data: { consultation }
    };

    // If idempotencyKey is provided, atomically complete the idempotency record in the same transaction
    if (idempotencyKey) {
      await idempotencyQuery.completeIdempotencyRecord(client, {
        userId: patientId,
        operation: OPERATION,
        key: idempotencyKey,
        responseCode: 201,
        responseBody: responsePayload
      });
    }

    await client.query('COMMIT');

    res.status(201).json(responsePayload);
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr.message);
      }
    }

    // Handle concurrent requests with the same idempotency key
    if (err.code === '23505') {
      if (err.constraint === 'uq_idempotency_user_op_key' || (idempotencyKey && err.detail?.includes('idempotency_keys'))) {
        const replay = await idempotencyQuery.getIdempotencyRecord(patientId, OPERATION, idempotencyKey);
        if (replay) {
          if (replay.request_hash !== requestHash) {
            return res.status(422).json({
              success: false,
              message: 'Idempotency key reused with a different request payload'
            });
          }
          if (replay.status === 'completed') {
            res.setHeader('Idempotent-Replayed', 'true');
            return res.status(replay.response_code).json(replay.response_body);
          }
        }
      }

      return res.status(409).json({
        success: false,
        message: 'This availability slot is already booked'
      });
    }

    next(err);
  } finally {
    if (client) {
      client.release();
    }
  }
};

const getConsultationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid consultation id'
      });
    }

    const consultation = await consultationQuery.getConsultationById(parsedId);

    if (!consultation) {
      return res.status(404).json({
        success: false,
        message: 'Consultation not found'
      });
    }

    // Enforce ownership
    if (req.user.role === 'patient' && parseInt(consultation.patient_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this consultation'
      });
    }

    if (req.user.role === 'doctor' && parseInt(consultation.doctor_user_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this consultation'
      });
    }

    res.status(200).json({
      success: true,
      data: { consultation }
    });
  } catch (err) {
    next(err);
  }
};

const listMyConsultations = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const { status, from, to, limit, offset } = req.query;

    // Validate status if provided
    if (status !== undefined) {
      const validStatuses = ['booked', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status filter. Allowed values: booked, confirmed, in_progress, completed, cancelled, no_show'
        });
      }
    }

    // Validate from and to dates
    if (from !== undefined) {
      const fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid from timestamp format'
        });
      }
    }

    if (to !== undefined) {
      const toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid to timestamp format'
        });
      }
    }

    // Validate pagination
    let parsedLimit = 50;
    if (limit !== undefined) {
      parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit <= 0 || parsedLimit > 100) {
        return res.status(400).json({
          success: false,
          message: 'limit must be a positive integer between 1 and 100'
        });
      }
    }

    let parsedOffset = 0;
    if (offset !== undefined) {
      parsedOffset = parseInt(offset, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return res.status(400).json({
          success: false,
          message: 'offset must be a non-negative integer'
        });
      }
    }

    const consultations = await consultationQuery.listUserConsultations({
      userId,
      role,
      status,
      fromDate: from,
      toDate: to,
      limit: parsedLimit,
      offset: parsedOffset
    });

    res.status(200).json({
      success: true,
      count: consultations.length,
      data: { consultations }
    });
  } catch (err) {
    next(err);
  }
};

const cancelConsultation = async (req, res, next) => {
  const { id } = req.params;
  const parsedId = parseInt(id, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid consultation id'
    });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Lock consultation for update
    const consultation = await consultationQuery.lockConsultationForUpdate(client, parsedId);
    if (!consultation) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Consultation not found'
      });
    }

    // 2. Resource-level authorization check
    if (req.user.role === 'patient' && parseInt(consultation.patient_id, 10) !== parseInt(req.user.id, 10)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to cancel this consultation'
      });
    }

    if (req.user.role === 'doctor' && parseInt(consultation.doctor_user_id, 10) !== parseInt(req.user.id, 10)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to cancel this consultation'
      });
    }

    // 3. Status checks: only 'booked' and 'confirmed' consultations can be cancelled
    if (consultation.status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel an already completed consultation'
      });
    }

    if (consultation.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Consultation is already cancelled'
      });
    }

    if (consultation.status === 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a consultation that is already in progress'
      });
    }

    if (consultation.status === 'no_show') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a consultation marked as no-show'
      });
    }

    // 4. Lock and update availability slot back to 'available'
    const slot = await availabilityQuery.lockSlotForBooking(client, consultation.availability_slot_id);
    if (!slot) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Associated availability slot not found'
      });
    }

    const cancelled = await consultationQuery.cancelConsultation(client, parsedId);
    const releasedSlot = await availabilityQuery.updateSlotStatus(client, consultation.availability_slot_id, 'available');

    if (!cancelled || !releasedSlot) {
      throw new Error('Failed to update consultation status or release availability slot');
    }

    await auditQuery.createAuditLog({
      actorUserId: req.user.id,
      action: 'CONSULTATION_CANCELLED',
      entityType: 'consultation',
      entityId: parsedId,
      requestId: req.id,
      metadata: {
        slotId: consultation.availability_slot_id,
        reason: req.body?.reason || 'cancelled_by_user'
      }
    }, client);

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Consultation cancelled successfully',
      data: { consultation: cancelled }
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr.message);
      }
    }
    next(err);
  } finally {
    if (client) {
      client.release();
    }
  }
};

const updateConsultation = async (req, res, next) => {
  const { id } = req.params;
  const parsedId = parseInt(id, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid consultation id'
    });
  }

  const { status, started_at, ended_at, notes } = req.body;

  // Reject requests with no editable fields
  if (status === undefined && started_at === undefined && ended_at === undefined && notes === undefined) {
    return res.status(400).json({
      success: false,
      message: 'At least one editable field (status, started_at, ended_at, notes) must be provided'
    });
  }

  // Validate status if provided
  const validStatuses = ['booked', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
  if (status !== undefined && !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid consultation status. Allowed values: booked, confirmed, in_progress, completed, cancelled, no_show'
    });
  }

  // Validate timestamps if provided
  if (started_at !== undefined) {
    const sDate = new Date(started_at);
    if (isNaN(sDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid started_at timestamp format'
      });
    }
  }

  if (ended_at !== undefined) {
    const eDate = new Date(ended_at);
    if (isNaN(eDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ended_at timestamp format'
      });
    }
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Lock consultation for update
    const existing = await consultationQuery.lockConsultationForUpdate(client, parsedId);

    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Consultation not found'
      });
    }

    // Role-based authorization
    if (req.user.role === 'doctor' && parseInt(existing.doctor_user_id, 10) !== parseInt(req.user.id, 10)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this consultation'
      });
    }

    // Terminal states cannot be modified
    if (['completed', 'cancelled', 'no_show'].includes(existing.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Cannot modify a consultation that is already ${existing.status}`
      });
    }

    // Validate status transitions
    if (status !== undefined && status !== existing.status) {

      // Valid transitions from 'booked'
      if (existing.status === 'booked' && !['confirmed', 'in_progress', 'cancelled', 'no_show'].includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${existing.status} to ${status}`
        });
      }

      // Valid transitions from 'confirmed'
      if (existing.status === 'confirmed' && !['in_progress', 'cancelled', 'no_show'].includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${existing.status} to ${status}`
        });
      }

      // Valid transitions from 'in_progress'
      if (existing.status === 'in_progress' && !['completed', 'no_show'].includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${existing.status} to ${status}`
        });
      }
    }

    // Validate timestamp chronology
    const effectiveStarted = started_at !== undefined ? started_at : existing.started_at;
    const effectiveEnded = ended_at !== undefined ? ended_at : existing.ended_at;

    if (effectiveStarted && effectiveEnded) {
      if (new Date(effectiveStarted) > new Date(effectiveEnded)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'started_at must be earlier than or equal to ended_at'
        });
      }
    }

    // If transitioning to cancelled via this endpoint, release the availability slot
    if (status === 'cancelled' && existing.status !== 'cancelled') {
      await availabilityQuery.lockSlotForBooking(client, existing.availability_slot_id);
      await availabilityQuery.updateSlotStatus(client, existing.availability_slot_id, 'available');
    }

    const consultation = await consultationQuery.updateConsultationLifecycle(client, parsedId, {
      status,
      startedAt: started_at,
      endedAt: ended_at,
      notes
    });

    await auditQuery.createAuditLog({
      actorUserId: req.user.id,
      action: 'CONSULTATION_STATUS_UPDATED',
      entityType: 'consultation',
      entityId: parsedId,
      requestId: req.id,
      metadata: {
        previousStatus: existing.status,
        newStatus: status || existing.status
      }
    }, client);

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Consultation status updated',
      data: { consultation }
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr.message);
      }
    }
    next(err);
  } finally {
    if (client) {
      client.release();
    }
  }
};

module.exports = {
  bookConsultation,
  getConsultationById,
  listMyConsultations,
  cancelConsultation,
  updateConsultation
};
