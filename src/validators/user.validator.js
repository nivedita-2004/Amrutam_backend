const { z } = require('zod');

const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name cannot be empty').max(255, 'Name cannot exceed 255 characters').optional(),
  email: z.string().trim().email('Invalid email address format').max(255, 'Email cannot exceed 255 characters').optional(),
  phone: z.string().trim().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format').optional(),
  date_of_birth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').refine((val) => !isNaN(Date.parse(val)), 'Invalid calendar date').optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say'], {
    errorMap: () => ({ message: 'Gender must be male, female, other, or prefer_not_to_say' })
  }).optional(),
  address: z.string().trim().max(500, 'Address cannot exceed 500 characters').optional(),
  emergency_contact: z.string().trim().max(100, 'Emergency contact cannot exceed 100 characters').optional()
}).strict();

module.exports = {
  updateProfileSchema
};
