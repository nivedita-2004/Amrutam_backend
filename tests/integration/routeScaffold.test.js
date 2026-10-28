const request = require('supertest');
const app = require('../../src/app');

describe('Route Scaffolding Integration Tests', () => {
  it('GET /non-existent-route should return 404 with standard error format', async () => {
    const res = await request(app).get('/api/v1/non-existent-route');
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Route not found');
    expect(res.body.requestId).toBeDefined();
  });
});
