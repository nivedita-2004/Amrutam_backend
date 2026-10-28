const { z } = require('zod');

// Schema for user signup
const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters long').max(100),
  email: z.string().trim().toLowerCase().email('Please provide a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(100),
  role: z.enum(['patient', 'doctor']).optional().default('patient'),
  specialization: z.string().min(2).max(100).optional(),
  qualification: z.string().min(2).max(255).optional()
});

// Schema for user login
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please provide a valid email address'),
  password: z.string().min(1, 'Password is required')
});

module.exports = {
  signupSchema,
  loginSchema
};
