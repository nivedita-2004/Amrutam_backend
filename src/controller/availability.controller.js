const { pool } = require('../config/db');
const availabilityQuery = require('../query/availability.query');
const doctorQuery = require('../query/doctor.query');
const auditQuery = require('../query/audit.query');

const createSlot = async (req, res, next) => {
  let client;
  try {
    const doctor = await doctorQuery.getDoctorByUserId(req.user.id);
    if (!doctor) {
      return res.status(403).json({
        success: false,
        message: 'Doctor profile not found for this user account'
      });
    }

    const { start_time, end_time } = req.body;

    if (!start_time || !end_time) {
      return res.status(400).json({
        success: false,
        message: 'start_time and end_time are required'
      });
    }

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use ISO 8601 timestamps'
      });
    }

    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        message: 'start_time must be earlier than end_time'
      });
    }

    if (startDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Availability slot must be scheduled in the future'
      });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // Acquire lock on doctor row to serialize slot creation under concurrent requests
    await availabilityQuery.lockDoctorForSlotOperations(client, doctor.id);

    const overlapping = await availabilityQuery.findOverlappingSlot(client, doctor.id, start_time, end_time);
    if (overlapping) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Availability slot overlaps with an existing active slot'
      });
    }

    const slot = await availabilityQuery.createSlot(client, doctor.id, start_time, end_time);

    await auditQuery.createAuditLog({
      actorUserId: req.user.id,
      action: 'SLOT_CREATED',
      entityType: 'availability_slot',
      entityId: slot.id,
      requestId: req.id,
      metadata: {
        doctorId: doctor.id,
        startTime: slot.start_time,
        endTime: slot.end_time
      }
    }, client);

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Availability slot created successfully',
      data: { slot }
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr.message);
      }
    }

    // Only genuine availability slot conflicts (exclusion violation 23P01 or slot unique violation 23505) return 409
    const isSlotConflict =
      err.code === '23P01' ||
      (err.code === '23505' && (err.constraint === 'uq_doctor_slot_start' || err.constraint === 'uq_doctor_slot_no_overlap' || err.table === 'availability_slots'));

    if (isSlotConflict) {
      return res.status(409).json({
        success: false,
        message: 'Availability slot overlaps with an existing active slot'
      });
    }

    req.log?.error?.({ err, doctorId: doctor?.id }, 'Unexpected database error during slot creation');
    next(err);
  } finally {
    if (client) {
      client.release();
    }
  }
};

const listSlots = async (req, res, next) => {
  try {
    // When requesting doctor-specific endpoint /doctor/:doctorId, the URL parameter
    // MUST take precedence and cannot be overridden by client-provided query strings.
    const rawDoctorId = req.params?.doctorId !== undefined
      ? req.params.doctorId
      : (req.query?.doctor_id !== undefined ? req.query.doctor_id : req.query?.doctorId);

    const { from, to, status, limit, offset } = req.query || {};

    // Validate doctor_id if provided
    let parsedDoctorId;
    if (rawDoctorId !== undefined) {
      parsedDoctorId = parseInt(rawDoctorId, 10);
      if (isNaN(parsedDoctorId) || parsedDoctorId <= 0 || !/^\d+$/.test(String(rawDoctorId).trim())) {
        return res.status(400).json({
          success: false,
          message: 'doctor_id must be a valid positive integer'
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

    // Validate status if provided
    if (status !== undefined) {
      const validStatuses = ['available', 'booked', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status filter. Allowed values: available, booked, cancelled'
        });
      }
    }

    // Validate limit and offset pagination
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

    // Ownership and visibility rules:
    // Public browsing and patients can ONLY view 'available' slots.
    // Non-available slots ('booked', 'cancelled') can only be queried by an authenticated doctor for their OWN slots.
    let targetStatus = 'available';

    if (status && status !== 'available') {
      if (!req.user || req.user.role !== 'doctor') {
        return res.status(403).json({
          success: false,
          message: 'Only doctors can view their own non-available slots'
        });
      }

      const doctor = await doctorQuery.getDoctorByUserId(req.user.id);
      if (!doctor || !parsedDoctorId || parsedDoctorId !== parseInt(doctor.id, 10)) {
        return res.status(403).json({
          success: false,
          message: 'You can only view non-available slots for your own doctor profile'
        });
      }

      targetStatus = status;
    }

    const slots = await availabilityQuery.listSlots({
      doctorId: parsedDoctorId,
      fromDate: from,
      toDate: to,
      status: targetStatus,
      limit: parsedLimit,
      offset: parsedOffset
    });

    res.status(200).json({
      success: true,
      count: slots.length,
      data: { slots }
    });
  } catch (err) {
    next(err);
  }
};

const getSlotById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid slot id'
      });
    }

    const slot = await availabilityQuery.getSlotById(parsedId);

    if (!slot) {
      return res.status(404).json({
        success: false,
        message: 'Availability slot not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { slot }
    });
  } catch (err) {
    next(err);
  }
};

const updateSlot = async (req, res, next) => {
  let client;
  try {
    const doctor = await doctorQuery.getDoctorByUserId(req.user.id);
    if (!doctor) {
      return res.status(403).json({
        success: false,
        message: 'Doctor profile not found for this user account'
      });
    }

    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid slot id'
      });
    }

    const { start_time, end_time, status } = req.body;

    // Reject requests containing no editable fields
    if (start_time === undefined && end_time === undefined && status === undefined) {
      return res.status(400).json({
        success: false,
        message: 'At least one editable field (start_time, end_time, status) must be provided'
      });
    }

    // Doctors must not mark slots as booked directly
    if (status === 'booked') {
      return res.status(400).json({
        success: false,
        message: 'Doctors cannot manually mark slots as booked. Booking status is managed by consultation workflows.'
      });
    }

    if (status !== undefined && status !== 'available' && status !== 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Invalid slot status. Allowed statuses are: available, cancelled'
      });
    }

    if (start_time !== undefined) {
      const startDate = new Date(start_time);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid start_time format. Use ISO 8601 timestamps'
        });
      }
      if (startDate <= new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Availability slot must be scheduled in the future'
        });
      }
    }

    if (end_time !== undefined) {
      const endDate = new Date(end_time);
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid end_time format. Use ISO 8601 timestamps'
        });
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // Lock the slot row to prevent races with patient bookings
    const existingSlot = await availabilityQuery.lockSlotForBooking(client, parsedId);

    if (!existingSlot) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Availability slot not found'
      });
    }

    if (parseInt(existingSlot.doctor_id, 10) !== parseInt(doctor.id, 10)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify another doctor’s availability slot'
      });
    }

    if (existingSlot.status === 'booked') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Cannot modify an availability slot that is already booked'
      });
    }

    const newStart = start_time || existingSlot.start_time;
    const newEnd = end_time || existingSlot.end_time;
    const startDate = new Date(newStart);
    const endDate = new Date(newEnd);

    if (startDate >= endDate) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'start_time must be earlier than end_time'
      });
    }

    if (start_time || end_time) {
      await availabilityQuery.lockDoctorForSlotOperations(client, doctor.id);
      const overlapping = await availabilityQuery.findOverlappingSlot(client, doctor.id, newStart, newEnd, parsedId);
      if (overlapping) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Availability slot overlaps with an existing active slot'
        });
      }
    }

    const updated = await availabilityQuery.updateSlot(client, parsedId, {
      startTime: start_time,
      endTime: end_time,
      status
    });

    await auditQuery.createAuditLog({
      actorUserId: req.user.id,
      action: 'SLOT_UPDATED',
      entityType: 'availability_slot',
      entityId: parsedId,
      requestId: req.id,
      metadata: {
        doctorId: doctor.id,
        startTime: updated.start_time,
        endTime: updated.end_time,
        status: updated.status
      }
    }, client);

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Availability slot updated successfully',
      data: { slot: updated }
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr.message);
      }
    }

    // Only genuine availability slot conflicts (exclusion violation 23P01 or slot unique violation 23505) return 409
    const isSlotConflict =
      err.code === '23P01' ||
      (err.code === '23505' && (err.constraint === 'uq_doctor_slot_start' || err.constraint === 'uq_doctor_slot_no_overlap' || err.table === 'availability_slots'));

    if (isSlotConflict) {
      return res.status(409).json({
        success: false,
        message: 'Availability slot overlaps with an existing active slot'
      });
    }

    req.log?.error?.({ err, slotId: parsedId }, 'Unexpected database error during slot update');
    next(err);
  } finally {
    if (client) {
      client.release();
    }
  }
};

const deleteSlot = async (req, res, next) => {
  let client;
  try {
    const doctor = await doctorQuery.getDoctorByUserId(req.user.id);
    if (!doctor) {
      return res.status(403).json({
        success: false,
        message: 'Doctor profile not found for this user account'
      });
    }

    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid slot id'
      });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // Lock the slot to avoid races with concurrent bookings
    const existingSlot = await availabilityQuery.lockSlotForBooking(client, parsedId);

    if (!existingSlot) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Availability slot not found'
      });
    }

    if (parseInt(existingSlot.doctor_id, 10) !== parseInt(doctor.id, 10)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete another doctor’s availability slot'
      });
    }

    if (existingSlot.status === 'booked') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Cannot delete an availability slot that is already booked'
      });
    }

    await availabilityQuery.deleteSlot(client, parsedId);

    await auditQuery.createAuditLog({
      actorUserId: req.user.id,
      action: 'SLOT_DELETED',
      entityType: 'availability_slot',
      entityId: parsedId,
      requestId: req.id,
      metadata: {
        doctorId: doctor.id,
        startTime: existingSlot.start_time,
        endTime: existingSlot.end_time
      }
    }, client);

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Availability slot deleted successfully'
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
  createSlot,
  listSlots,
  getSlotById,
  updateSlot,
  deleteSlot
};
