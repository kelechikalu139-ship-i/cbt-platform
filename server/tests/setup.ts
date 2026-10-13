/**
 * Global test setup.
 *
 * Forces `NODE_ENV=test` before any application module is imported, because
 * `src/config/env.ts` validates the environment at import time and reads that
 * value to decide whether to refuse placeholder secrets.
 */
process.env.NODE_ENV = 'test'

// Deterministic, obviously-fake secrets. Real deployments must supply their own;
// `env.ts` refuses to boot in production if these values are still in place.
process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_that_is_long_enough_0123456789'
process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_that_is_long_enough_0123456789'
process.env.DATABASE_URL ??= 'mysql://cbt:cbtpass@127.0.0.1:3306/cbt_system'

// Keep bcrypt cheap so the suite is not dominated by hashing.
process.env.BCRYPT_SALT_ROUNDS = '4'

// The auth limiter is disabled for most tests but exercised explicitly; a low
// ceiling here would make unrelated suites fail as they accumulate requests.
process.env.AUTH_RATE_LIMIT_MAX = '1000'
process.env.GLOBAL_RATE_LIMIT_MAX = '100000'