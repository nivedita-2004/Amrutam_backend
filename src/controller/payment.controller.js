const paymentQuery = require('../query/payment.query');
const consultationQuery = require('../query/consultation.query');
const auditQuery = require('../query/audit.query');

const recordPayment = async (req, res, next) => {
  try {
    const { consultation_id, amount, currency, status, provider_reference } = req.body;

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

    // Role and ownership check
    if (req.user.role === 'patient' && parseInt(consultation.patient_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to process payments for another patient's consultation"
      });
    }

    if (req.user.role === 'doctor') {
      return res.status(403).json({
        success: false,
        message: 'Doctors cannot record patient payments'
      });
    }

    const existingPayment = await paymentQuery.getPaymentByConsultationId(parsedConsultationId);
    if (existingPayment && existingPayment.status === 'completed') {
      return res.status(409).json({
        success: false,
        message: 'This consultation is already paid'
      });
    }

    const validStatuses = ['pending', 'completed', 'failed', 'refunded'];
    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status. Allowed values: pending, completed, failed, refunded'
      });
    }

    const paymentAmount = amount !== undefined ? parseFloat(amount) : parseFloat(consultation.consultation_fee);
    if (isNaN(paymentAmount) || paymentAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'amount must be a non-negative number'
      });
    }

    const payment = await paymentQuery.upsertPaymentRecord({
      consultationId: parsedConsultationId,
      amount: paymentAmount,
      currency: currency || 'INR',
      status: status || 'completed',
      providerReference: provider_reference || null
    });

    await auditQuery.recordAuditLog({
      actorUserId: req.user.id,
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: payment.id,
      requestId: req.id,
      metadata: {
        consultationId: parsedConsultationId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status
      }
    });

    res.status(200).json({
      success: true,
      message: 'Payment record processed successfully',
      data: { payment }
    });
  } catch (err) {
    next(err);
  }
};

const getPaymentByConsultation = async (req, res, next) => {
  try {
    const { consultationId } = req.params;
    const parsedConsultationId = parseInt(consultationId, 10);
    if (isNaN(parsedConsultationId) || parsedConsultationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid consultationId'
      });
    }

    const consultation = await consultationQuery.getConsultationById(parsedConsultationId);
    if (!consultation) {
      return res.status(404).json({
        success: false,
        message: 'Consultation not found'
      });
    }

    // Role-based access control
    if (req.user.role === 'patient' && parseInt(consultation.patient_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view payment records for this consultation'
      });
    }

    if (req.user.role === 'doctor' && parseInt(consultation.doctor_user_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view payment records for this consultation'
      });
    }

    const payment = await paymentQuery.getPaymentByConsultationId(parsedConsultationId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment record not found for this consultation'
      });
    }

    res.status(200).json({
      success: true,
      data: { payment }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  recordPayment,
  getPaymentByConsultation
};
