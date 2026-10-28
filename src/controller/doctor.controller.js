const doctorQuery = require('../query/doctor.query');

const listDoctors = async (req, res, next) => {
  try {
    const { specialization, limit, offset } = req.query;
    const doctors = await doctorQuery.listDoctors({
      specialization,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0
    });

    res.status(200).json({
      success: true,
      data: { doctors }
    });
  } catch (err) {
    next(err);
  }
};

const getDoctorById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doctorId = parseInt(id, 10);
    if (isNaN(doctorId) || doctorId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid doctor ID. Must be a valid positive integer.'
      });
    }

    const doctor = await doctorQuery.getDoctorById(doctorId);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Verification visibility rule: unverified doctors are not publicly visible
    // Only allow access if verified OR if the requester is the doctor themselves OR an admin
    const isOwner = req.user && req.user.id === doctor.user_id;
    const isAdmin = req.user && req.user.role === 'admin';
    if (doctor.verification_status !== 'verified' && !isOwner && !isAdmin) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { doctor }
    });
  } catch (err) {
    next(err);
  }
};

const getMyDoctorProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const doctor = await doctorQuery.getDoctorByUserId(userId);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { doctor }
    });
  } catch (err) {
    next(err);
  }
};

const updateDoctorProfile = async (req, res, next) => {
  try {
    // req.user.id is the authenticated user ID (users.id) from JWT payload
    const userId = req.user.id;
    const doctor = await doctorQuery.upsertDoctorProfile(userId, req.body);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Doctor profile updated successfully',
      data: { doctor }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listDoctors,
  getDoctorById,
  getMyDoctorProfile,
  updateDoctorProfile
};
