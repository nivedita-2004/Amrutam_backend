const { z } = require('zod');

const bookConsultationSchema = z.object({
  doctor_id: z.coerce.number().int().positive('doctor_id must be a positive integer'),
  availability_slot_id: z.coerce.number().int().positive('availability_slot_id must be a positive integer'),
  notes: z.string().max(500).optional()
});

const updateConsultationSchema = z.object({
  status: z.enum(['booked', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']).optional(),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
  notes: z.string().max(2000).optional()
});

module.exports = {
  bookConsultationSchema,
  updateConsultationSchema
};
