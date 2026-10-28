const { pool, connectDB } = require('../../src/config/db');

describe('Database Connection Module (src/config/db.js)', () => {
  it('should successfully test the database connection and log success', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await connectDB();

    expect(consoleSpy).toHaveBeenCalledWith('Database connected successfully.');
    consoleSpy.mockRestore();
  });

  it('should log failure and exit process when database connection fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit: ${code}`);
    });
    const poolQuerySpy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('Connection refused mock'));

    await expect(connectDB()).rejects.toThrow('process.exit: 1');

    expect(errorSpy).toHaveBeenCalledWith('Database connection failed:', 'Connection refused mock');
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
    poolQuerySpy.mockRestore();
  });

  it('should execute a parameterized query via exported pool', async () => {
    const res = await pool.query('SELECT $1::text AS test', ['ayurveda']);
    expect(res.rows[0].test).toBe('ayurveda');
  });
});
