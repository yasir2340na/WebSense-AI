import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/test_helpers/setup.js'],
    include: ['tests/**/*.test.js'],
    exclude: [
      'tests/e2e/**',
      'tests/integration/api.test.js',
      'tests/integration/extension.test.js',
      'tests/integration/messaging.test.js',
      'tests/unit/voice.test.js',
      'tests/unit/autofill.test.js',
      'tests/unit/encryption.test.js',
      'tests/unit/security.test.js',
      'tests/unit/translation.test.js',
    ],
    coverage: {
      reporter: ['text', 'html'],
      include: [
        'backend/utils/**',
        'extension/src/**',
      ],
    },
  },
});
