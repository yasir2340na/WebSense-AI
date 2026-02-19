/**
 * Global test setup for Vitest.
 * Installs Chrome API mocks and common test utilities.
 */

import { installMockChrome } from './mockChrome.js';

// Install Chrome mock before each test suite
beforeEach(() => {
  installMockChrome();
});

// Clean up after each test
afterEach(() => {
  delete globalThis.chrome;
  vi.restoreAllMocks();
});
