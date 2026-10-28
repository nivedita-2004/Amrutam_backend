const adminQuery = require('../query/admin.query');
const auditQuery = require('../query/audit.query');

const getMetrics = async (req, res, next) => {
  try {
    const metrics = await adminQuery.getSystemMetrics();

    res.status(200).json({
      success: true,
      data: { metrics }
    });
  } catch (err) {
    next(err);
  }
};

const listPendingDoctors = async (req, res, next) => {
  try {
    const pendingDoctors = await adminQuery.listPendingDoctorVerifications();

    res.status(200).json({
      success: true,
      data: { doctors: pendingDoctors }
    });
  } catch (err) {
    next(err);
  }
};

const verifyDoctor = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be either 'verified' or 'rejected'"
      });
    }

    const doctorId = parseInt(id, 10);
    if (isNaN(doctorId) || doctorId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid doctor ID. Must be a valid positive integer.'
      });
    }

    const doctor = await adminQuery.verifyDoctor(doctorId, status);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    // Record audit log for doctor verification change
    await auditQuery.recordAuditLog({
      actorUserId: req.user.id,
      action: status === 'verified' ? 'ADMIN_DOCTOR_VERIFIED' : 'ADMIN_DOCTOR_REJECTED',
      entityType: 'doctor',
      entityId: doctor.id,
      requestId: req.id,
      metadata: { doctorId: doctor.id, doctorUserId: doctor.user_id, status }
    });

    res.status(200).json({
      success: true,
      message: `Doctor verification status updated to ${status}`,
      data: { doctor }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMetrics,
  listPendingDoctors,
  verifyDoctor
};
