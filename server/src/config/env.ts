import 'dotenv/config'
import { z } from 'zod'

/**
 * Environment configuration.
 *
 * Parsed and validated exactly once, at import time. Every other module imports
 * the typed `env` object rather than touching `process.env`, which means an
 * invalid or missing variable stops the process before any listener is opened
 * and before the database is touched (§6).
 *
 * Secrets are never logged. The only thing printed on failure is the *name* of
 * the offending variable and why it was rejected.
 */

/** Values that must never reach production, however they are quoted. */
const PLACEHOLDER_SECRETS = new Set([
  'change_me',
  'change_me_to_a_long_random_string',
  'change_me_to_another_long_random_string',
  'secret',
  'changeme',
])

const booleanish = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((value) => value === 'true' || value === '1' || value === 'yes')

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)))

const durationPattern = /^\d+[smhd]$|^\d+$/

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  /** `0.0.0.0` is what makes the API reachable from student machines (§34). */
  HOST: z.string().min(1).default('0.0.0.0'),

  APP_NAME: z.string().min(1).default('CBT Examination System'),
  APP_VERSION: z.string().min(1).default('1.0.0'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => /^mysql:\/\/[^:]+:[^@]*@[^:]+:\d+\/\S+$/.test(value),
      'DATABASE_URL must look like mysql://user:password@host:3306/database',
    ),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(10_000),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .regex(durationPattern, 'must look like 15m, 1h, 7d or a plain number of seconds')
    .default('15m'),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(durationPattern, 'must look like 15m, 1h, 7d or a plain number of seconds')
    .default('7d'),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  CORS_ORIGIN: csv.default(['http://localhost:5173']),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanish.default(true),

  /** Folder uploaded files (logos, ...) are stored in, relative to the server cwd. */
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  /** Largest single upload accepted, in mebibytes. */
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().min(1).max(100).default(5),

  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  GLOBAL_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(3000),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@cbt.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
  SEED_ADMIN_FIRST_NAME: z.string().min(1).default('System'),
  SEED_ADMIN_LAST_NAME: z.string().min(1).default('Administrator'),
})

function load(): z.infer<typeof schema> {
  const parsed = schema.safeParse(process.env)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    // Deliberately printed to stderr as plain text: the logger itself depends on
    // this module, and a config error must be readable even before logging works.
    process.stderr.write(
      `\nCBT server cannot start — invalid environment configuration:\n${details}\n\n` +
        'Copy server/.env.example to server/.env and fill in the missing values.\n\n',
    )
    process.exit(1)
  }

  const value = parsed.data

  // A shared or placeholder secret would let anyone mint tokens for the school.
  if (value.NODE_ENV === 'production') {
    const problems: string[] = []

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const secret = value[key]
      if (PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())) {
        problems.push(`${key} still holds a placeholder value`)
      }
    }

    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ')
    }

    if (value.CORS_ORIGIN.includes('*')) {
      problems.push('CORS_ORIGIN must not be "*" in production')
    }

    if (problems.length > 0) {
      process.stderr.write(
        `\nCBT server cannot start — unsafe production configuration:\n${problems
          .map((p) => `  - ${p}`)
          .join('\n')}\n\n`,
      )
      process.exit(1)
    }
  }

  return value
}

export const env = load()

export type Env = typeof env

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
export const isDevelopment = env.NODE_ENV === 'development'