import { defineConfig } from 'vitest/config'

/**
 * Test configuration.
 *
 * Two suites run here:
 *
 * - **Unit tests** exercise pure logic (validation, pagination, tokens, password
 *   hashing, grading) and need no database.
 * - **Integration tests** boot the real Express app against the real MariaDB via
 *   `supertest`, so routing, middleware and Prisma are all covered together.
 *
 * `fileParallelism` is disabled because every integration test shares one
 * database; running suites in parallel would let one test's fixture data leak
 * into another's assertions.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Serial execution keeps the shared database consistent between suites.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
})