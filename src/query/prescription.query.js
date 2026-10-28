const { pool } = require('../config/db');

const createPrescription = async ({ consultationId, doctorId, patientId, prescriptionDetails, notes }) => {
  const sql = `
    INSERT INTO prescriptions (consultation_id, doctor_id, patient_id, prescription_details, notes)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, consultation_id, doctor_id, patient_id, prescription_details, notes, created_at;
  `;
  const res = await pool.query(sql, [consultationId, doctorId, patientId, JSON.stringify(prescriptionDetails), notes]);
  return res.rows[0];
};

const getPrescriptionById = async (id) => {
  const sql = `
    SELECT 
      p.id, p.consultation_id, p.doctor_id, p.patient_id,
      p.prescription_details, p.notes, p.created_at,
      d.user_id AS doctor_user_id,
      u_doctor.name AS doctor_name, d.specialization,
      u_patient.name AS patient_name
    FROM prescriptions p
    JOIN doctors d ON p.doctor_id = d.id
    JOIN users u_doctor ON d.user_id = u_doctor.id
    JOIN users u_patient ON p.patient_id = u_patient.id
    WHERE p.id = $1;
  `;
  const res = await pool.query(sql, [id]);
  return res.rows[0] || null;
};

const listPrescriptionsForPatient = async (patientId) => {
  const sql = `
    SELECT 
      p.id, p.consultation_id, p.doctor_id, p.prescription_details, p.notes, p.created_at,
      u_doctor.name AS doctor_name, d.specialization
    FROM prescriptions p
    JOIN doctors d ON p.doctor_id = d.id
    JOIN users u_doctor ON d.user_id = u_doctor.id
    WHERE p.patient_id = $1
    ORDER BY p.created_at DESC;
  `;
  const res = await pool.query(sql, [patientId]);
  return res.rows;
};

const listPrescriptionsForDoctor = async (doctorUserId) => {
  const sql = `
    SELECT 
      p.id, p.consultation_id, p.doctor_id, p.patient_id, p.prescription_details, p.notes, p.created_at,
      u_patient.name AS patient_name
    FROM prescriptions p
    JOIN doctors d ON p.doctor_id = d.id
    JOIN users u_patient ON p.patient_id = u_patient.id
    WHERE d.user_id = $1
    ORDER BY p.created_at DESC;
  `;
  const res = await pool.query(sql, [doctorUserId]);
  return res.rows;
};

module.exports = {
  createPrescription,
  getPrescriptionById,
  listPrescriptionsForPatient,
  listPrescriptionsForDoctor
};
