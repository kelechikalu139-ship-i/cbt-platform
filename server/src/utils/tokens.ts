import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { env } from '../config/env.js'

/**
 * JWT issuing and verification (§15).
 *
 * Two token types with different secrets, so a leaked refresh token cannot be
 * replayed as an access token and vice versa. The access token is deliberately
 * short-lived; the refresh token is long-lived but stored server-side *only as a
 * SHA-256 digest*, which means a stolen database dump cannot be replayed against
 * the API.
 *
 * The payload carries identity and nothing else (§15). No password material, no
 * answer keys, no license secrets, no student answers — a JWT is readable by
 * anyone holding it, so it is only ever a pointer to server-side state.
 */

export interface AccessTokenPayload {
  sub: string
  email: string
  role: string
  /**
   * Student sign-in session id. Present only for student accounts, which
   * hold exactly one live session: the middleware compares the digest of
   * this value against the one stored on the user row, so a session
   * ended by the student or an administrator stops working immediately.
   */
  sid?: string
  /** Token class, checked on verification to reject cross-type confusion. */
  typ: 'access'
}

export interface RefreshTokenPayload {
  sub: string
  /**
   * Student sign-in session id. Present only for student accounts so the
   * refresh endpoint can slide the session without re-creating a new id.
   */
  sid?: string
  /** Binds the token to the stored digest, invalidating it on rotation. */
  jti: string
  typ: 'refresh'
}

export interface SignedToken {
  token: string
  expiresIn: string
}

/**
 * The configured lifetime is validated against `/^\d+[smhd]$|^\d+$/` in `env.ts`.
 * `jsonwebtoken` types `expiresIn` as a template-literal union, which a plain
 * `string` cannot satisfy, so the validated value is narrowed once here rather
 * than cast at each call site.
 */
const accessExpiresIn = env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn']
const refreshExpiresIn = env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn']

export function signAccessToken(payload: Omit<AccessTokenPayload, 'typ'>): SignedToken {
  const token = jwt.sign({ ...payload, typ: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: accessExpiresIn,
    algorithm: 'HS256',
  })

  return { token, expiresIn: env.JWT_ACCESS_EXPIRES_IN }
}

export function signRefreshToken(userId: string, sid?: string): SignedToken {
  const jti = randomBytes(16).toString('hex')
  const token = jwt.sign({ sub: userId, sid, jti, typ: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: refreshExpiresIn,
    algorithm: 'HS256',
  })

  return { token, expiresIn: env.JWT_REFRESH_EXPIRES_IN }
}

/**
 * Verify a token and assert its type.
 *
 * The `typ` check matters: both tokens are HS256 but signed with different
 * secrets, and an explicit type assertion keeps the intent obvious and survives a
 * future move to a shared signing key.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] })
  if (typeof decoded === 'string' || decoded.typ !== 'access') {
    throw new jwt.JsonWebTokenError('Not an access token')
  }
  return decoded as unknown as AccessTokenPayload
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] })
  if (typeof decoded === 'string' || decoded.typ !== 'refresh') {
    throw new jwt.JsonWebTokenError('Not a refresh token')
  }
  return decoded as unknown as RefreshTokenPayload
}

/**
 * Hash a token for storage.
 *
 * SHA-256 rather than bcrypt on purpose: these are high-entropy random
 * values already produced by the sign* functions, so there is nothing to
 * brute-force, and verification happens on every authenticated request.
 */
export function hashTokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Constant-time comparison of a presented token against the stored digest.
 *
 * `timingSafeEqual` throws on length mismatch, so the lengths are compared first.
 */
export function matchesTokenDigest(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false
  const presented = Buffer.from(hashTokenDigest(token), 'utf8')
  const stored = Buffer.from(storedHash, 'utf8')
  if (presented.length !== stored.length) return false
  return timingSafeEqual(presented, stored)
}

/**
 * Parse a JWT lifetime string ("15m", "2h", "7d", or a plain number of
 * seconds) into milliseconds, for deriving a session expiry from the
 * configured refresh-token lifetime.
 */
export function lifetimeToMs(value: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(value.trim())
  if (!match) return 0
  const amount = Number(match[1])
  const unit = match[2]
  const perUnit =
    unit === 's' ? 1_000 :
    unit === 'm' ? 60_000 :
    unit === 'h' ? 3_600_000 :
    unit === 'd' ? 86_400_000 :
    1_000
  return amount * perUnit
}

/** Seconds until a JWT expires, for a client's silent-refresh scheduling. */
export function secondsUntilExpiry(token: string): number {
  const decoded = jwt.decode(token)
  if (!decoded || typeof decoded === 'string' || typeof decoded.exp !== 'number') {
    return 0
  }
  return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000))
}