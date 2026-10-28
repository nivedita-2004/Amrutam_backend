const prescriptionQuery = require('../query/prescription.query');
const consultationQuery = require('../query/consultation.query');
const doctorQuery = require('../query/doctor.query');
const auditQuery = require('../query/audit.query');

const createPrescription = async (req, res, next) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({
        success: false,
        message: 'Only registered doctors can issue prescriptions'
      });
    }

    const doctor = await doctorQuery.getDoctorByUserId(req.user.id);
    if (!doctor) {
      return res.status(403).json({
        success: false,
        message: 'Doctor profile not found for this user account'
      });
    }

    const { consultation_id, prescription_details, notes } = req.body;

    const parsedConsultationId = parseInt(consultation_id, 10);
    if (!consultation_id || isNaN(parsedConsultationId) || parsedConsultationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'consultation_id must be a valid positive integer'
      });
    }

    const consultation = await consultationQuery.getConsultationById(parsedConsultationId);
    if (!consultation) {
      return res.status(404).json({
        success: false,
        message: 'Consultation not found'
      });
    }

    if (parseInt(consultation.doctor_id, 10) !== parseInt(doctor.id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'You can only issue prescriptions for consultations assigned to you'
      });
    }

    const prescription = await prescriptionQuery.createPrescription({
      consultationId: parsedConsultationId,
      doctorId: doctor.id,
      patientId: consultation.patient_id,
      prescriptionDetails: prescription_details,
      notes: notes || null
    });

    await auditQuery.recordAuditLog({
      actorUserId: req.user.id,
      action: 'PRESCRIPTION_CREATED',
      entityType: 'prescription',
      entityId: prescription.id,
      requestId: req.id,
      metadata: {
        consultationId: parsedConsultationId,
        patientId: consultation.patient_id,
        doctorId: doctor.id
      }
    });

    res.status(201).json({
      success: true,
      message: 'Prescription recorded successfully',
      data: { prescription }
    });
  } catch (err) {
    next(err);
  }
};

const getPrescriptionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid prescription id'
      });
    }

    const prescription = await prescriptionQuery.getPrescriptionById(parsedId);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    // Role-based ownership enforcement
    if (req.user.role === 'patient' && parseInt(prescription.patient_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this prescription'
      });
    }

    if (req.user.role === 'doctor' && parseInt(prescription.doctor_user_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this prescription'
      });
    }

    res.status(200).json({
      success: true,
      data: { prescription }
    });
  } catch (err) {
    next(err);
  }
};

const listMyPrescriptions = async (req, res, next) => {
  try {
    let prescriptions = [];

    if (req.user.role === 'patient') {
      prescriptions = await prescriptionQuery.listPrescriptionsForPatient(req.user.id);
    } else if (req.user.role === 'doctor') {
      prescriptions = await prescriptionQuery.listPrescriptionsForDoctor(req.user.id);
    } else if (req.user.role === 'admin') {
      prescriptions = await prescriptionQuery.listPrescriptionsForPatient(req.user.id);
    }

    res.status(200).json({
      success: true,
      count: prescriptions.length,
      data: { prescriptions }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createPrescription,
  getPrescriptionById,
  listMyPrescriptions
};
