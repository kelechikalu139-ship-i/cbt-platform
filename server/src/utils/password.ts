import bcrypt from 'bcrypt'
import { env } from '../config/env.js'

/**
 * Password hashing (§14).
 *
 * bcrypt only, and only through these three functions, so the cost factor is
 * applied consistently everywhere. A plaintext password must never reach the
 * database, a log line, or an error message.
 *
 * The work factor comes from configuration rather than being hardcoded so a
 * deployment on modest lab hardware can lower it once and stay consistent.
 */

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, env.BCRYPT_SALT_ROUNDS)
}

/**
 * Compare a candidate password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or missing hash. A user row
 * whose `passwordHash` is unusable must fail authentication, never crash the
 * sign-in endpoint.
 */
export async function comparePassword(plaintext: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash || typeof hash !== 'string') return false
  try {
    return await bcrypt.compare(plaintext, hash)
  } catch {
    return false
  }
}

/**
 * Reject passwords that are trivially weak at the point they are set.
 *
 * Deliberately a floor rather than a full policy: schools define their own rules,
 * and the goal is only to stop `password`, `123456` and the seeded default from
 * ever reaching a real account.
 */
export const MIN_PASSWORD_LENGTH = 8

export function assertPasswordAcceptable(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }

  const hasLetter = /[a-zA-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)

  if (!hasLetter || !hasNumber) {
    return 'Password must contain at least one letter and one number'
  }

  // Reject the seeded development default so it cannot be carried into
  // production by accident.
  if (password === env.SEED_ADMIN_PASSWORD && env.NODE_ENV === 'production') {
    return 'Password must not be the default development password'
  }

  return null
}