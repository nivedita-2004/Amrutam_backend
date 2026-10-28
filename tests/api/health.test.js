const request = require('supertest');
const app = require('../../src/app');

describe('Health Endpoints', () => {
  it('GET /health/live should return 200 with status UP', async () => {
    const res = await request(app).get('/health/live');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('GET /health/ready should return either 200 or 503 depending on db connectivity', async () => {
    const res = await request(app).get('/health/ready');
    expect([200, 503]).toContain(res.statusCode);
    expect(['UP', 'DOWN']).toContain(res.body.status);
    expect(['connected', 'disconnected']).toContain(res.body.database);
    expect(res.body.timestamp).toBeDefined();
  });
});
