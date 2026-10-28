const { z } = require('zod');

const createSlotSchema = z.object({
  start_time: z.string().datetime({ message: 'start_time must be an ISO 8601 timestamp' }),
  end_time: z.string().datetime({ message: 'end_time must be an ISO 8601 timestamp' })
}).refine(
  (data) => new Date(data.start_time) < new Date(data.end_time),
  { message: 'start_time must be earlier than end_time', path: ['end_time'] }
);

module.exports = {
  createSlotSchema
};
