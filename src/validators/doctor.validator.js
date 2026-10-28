const { z } = require('zod');

const doctorProfileSchema = z.object({
  specialization: z.string().trim().min(2, 'Specialization must be at least 2 characters').max(100, 'Specialization cannot exceed 100 characters').optional(),
  qualification: z.string().trim().min(2, 'Qualification must be at least 2 characters').max(255, 'Qualification cannot exceed 255 characters').optional(),
  experience_years: z.number().int('Experience years must be an integer').min(0, 'Experience years cannot be negative').optional(),
  consultation_fee: z.number().min(0, 'Consultation fee cannot be negative').optional(),
  bio: z.string().trim().max(1000, 'Bio cannot exceed 1000 characters').optional()
}).strict();

module.exports = {
  doctorProfileSchema
};
