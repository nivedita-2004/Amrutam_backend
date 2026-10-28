const { z } = require('zod');

const createPrescriptionSchema = z.object({
  consultation_id: z.coerce.number().int().positive('consultation_id must be a positive integer'),
  prescription_details: z.record(z.any()).refine(
    (val) => Object.keys(val).length > 0,
    { message: 'Prescription details cannot be empty' }
  ),
  notes: z.string().max(1000).optional()
});

module.exports = {
  createPrescriptionSchema
};
