import { describe, expect, it } from 'vitest'
import {
  hashTokenDigest,
  matchesTokenDigest,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../src/utils/tokens.js'

/**
 * Token tests (§15).
 *
 * The most important assertions here are the negative ones: that a refresh token
 * cannot be used as an access token and vice versa. A shared secret or a missing
 * type check would let a long-lived refresh token be replayed as a short-lived
 * access token.
 */
describe('JWT utilities', () => {
  const subject = '11111111-1111-4111-8111-111111111111'

  it('issues an access token carrying the caller identity', () => {
    const { token } = signAccessToken({ sub: subject, email: 'staff@cbt.local', role: 'ADMIN' })
    const payload = verifyAccessToken(token)

    expect(payload.sub).toBe(subject)
    expect(payload.email).toBe('staff@cbt.local')
    expect(payload.role).toBe('ADMIN')
    expect(payload.typ).toBe('access')
  })

  it('issues a refresh token with a unique id', () => {
    const first = signRefreshToken(subject)
    const second = signRefreshToken(subject)

    expect(verifyRefreshToken(first.token).jti).toBeTruthy()
    // Two tokens for the same user must not share an identifier, otherwise
    // rotation could not distinguish them.
    expect(first.token).not.toBe(second.token)
    expect(verifyRefreshToken(first.token).jti).not.toBe(verifyRefreshToken(second.token).jti)
  })

  it('refuses a refresh token presented as an access token', () => {
    const { token } = signRefreshToken(subject)
    expect(() => verifyAccessToken(token)).toThrow()
  })

  it('refuses an access token presented as a refresh token', () => {
    const { token } = signAccessToken({ sub: subject, email: 'staff@cbt.local', role: 'ADMIN' })
    expect(() => verifyRefreshToken(token)).toThrow()
  })

  it('refuses a token signed with a foreign secret', () => {
    // Same shape, different signature.
    const forged = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiJhZG1pbiIsInR5cCI6ImFjY2VzcyIsImV4cCI6NDEwMjQ0NDgwMH0',
      'ZmFrZS1zaWduYXR1cmUtdGhhdC13aWxsLW5vdC12ZXJpZnk',
    ].join('.')

    expect(() => verifyAccessToken(forged)).toThrow()
  })

  it('rejects a tampered payload', () => {
    const { token } = signAccessToken({ sub: subject, email: 'staff@cbt.local', role: 'ADMIN' })
    const [header, , signature] = token.split('.')
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: subject, email: 'attacker@evil.local', role: 'SUPER_ADMIN', typ: 'access' }),
    ).toString('base64url')

    expect(() => verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).toThrow()
  })

  it('hashes refresh tokens deterministically without exposing them', () => {
    const { token } = signRefreshToken(subject)
    const digest = hashTokenDigest(token)

    expect(digest).toHaveLength(64)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).not.toContain(token)
    expect(hashTokenDigest(token)).toBe(digest)
  })

  it('matches only the token that produced the stored digest', () => {
    const { token } = signRefreshToken(subject)
    const digest = hashTokenDigest(token)

    expect(matchesTokenDigest(token, digest)).toBe(true)
    expect(matchesTokenDigest(signRefreshToken(subject).token, digest)).toBe(false)
  })

  it('treats a missing stored digest as no match', () => {
    const { token } = signRefreshToken(subject)
    expect(matchesTokenDigest(token, null)).toBe(false)
    expect(matchesTokenDigest(token, undefined)).toBe(false)
  })

  it('never places sensitive material in a token payload', () => {
    const { token } = signAccessToken({ sub: subject, email: 'staff@cbt.local', role: 'ADMIN' })
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())

    // §15: no password, hash, answers, or licence secrets in a JWT.
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(['sub', 'email', 'role', 'typ', 'iat', 'exp']),
    )
    expect(JSON.stringify(payload).toLowerCase()).not.toContain('password')
    expect(JSON.stringify(payload).toLowerCase()).not.toContain('correctanswer')
  })
})