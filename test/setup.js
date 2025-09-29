import { jest } from '@jest/globals';

// Global test setup
beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  if (!process.env.VERBOSE_TESTS) {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  }
});

afterAll(() => {
  // Restore console output
  if (!process.env.VERBOSE_TESTS) {
    console.log.mockRestore?.();
    console.info.mockRestore?.();
    console.warn.mockRestore?.();
    console.error.mockRestore?.();
  }
});

// Increase timeout for integration tests
jest.setTimeout(30000);