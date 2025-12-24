import dotenv from 'dotenv';

// Load test environment
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Mock console for cleaner test output
if (process.env.SILENT_TESTS === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
}

// Increase timeout for integration tests
jest.setTimeout(30000);

// Clean up after all tests
afterAll(async () => {
  // Close any open connections
  try {
    const { closeDatabase } = require('../database/connection');
    const { closeRedis } = require('../cache/redis');
    await closeDatabase();
    await closeRedis();
  } catch {
    // Ignore errors during cleanup
  }
});
