import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Application } from 'express'
import { createApp } from '../src/app.js'
import { prisma } from '../src/config/database.js'
import { hashPassword } from '../src/utils/password.js'
import { ROLE_CODES } from '../src/constants/permissions.js'

/**
 * Authentication and authorisation integration tests (§13, §16, §40).
 *
 * Runs the real Express app against the real database, so routing, validation,
 * the authenticate middleware and the permission guards are all exercised
 * together. Fixtures are created with unique identifiers and removed afterwards,
 * leaving the seeded development data untouched.
 */

let app: Application

const stamp = Date.now().toString(36)
const PASSWORD = 'IntegrationPass1'

const invigilator = {
  email: `invigilator-${stamp}@cbt.test`,
  firstName: 'Ivy',
  lastName: 'Invigilator',
}
const lecturer = {
  email: `lecturer-${stamp}@cbt.test`,
  firstName: 'Leo',
  lastName: 'Lecturer',
}

let invigilatorToken: string
let lecturerToken: string

beforeAll(async () => {
  app = createApp()

  // Roles come from the seed; create the accounts if they are missing.
  const roleIds = new Map<string, string>()
  for (const role of await prisma.role.findMany({ select: { id: true, code: true } })) {
    roleIds.set(role.code, role.id)
  }

  const passwordHash = await hashPassword(PASSWORD)

  await prisma.user.create({
    data: {
      email: invigilator.email,
      passwordHash,
      firstName: invigilator.firstName,
      lastName: invigilator.lastName,
      roleId: roleIds.get(ROLE_CODES.INVIGILATOR)!,
    },
  })

  await prisma.user.create({
    data: {
      email: lecturer.email,
      passwordHash,
      firstName: lecturer.firstName,
      lastName: lecturer.lastName,
      roleId: roleIds.get(ROLE_CODES.LECTURER)!,
    },
  })

  const signIn = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: invigilator.email, password: PASSWORD })

  invigilatorToken = signIn.body.data.accessToken

  const lecturerSignIn = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: lecturer.email, password: PASSWORD })

  lecturerToken = lecturerSignIn.body.data.accessToken
})

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: [invigilator.email, lecturer.email] } },
  })
  await prisma.$disconnect()
})

/* -------------------------------------------------------------------------- */
/* Authentication                                                              */
/* -------------------------------------------------------------------------- */

describe('POST /api/v1/auth/login', () => {
  it('rejects a wrong password with a generic message', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: invigilator.email, password: 'WrongPass1' })

    expect(response.status).toBe(401)
    expect(response.body.success).toBe(false)
    expect(response.body.message).toBe('Invalid email or password')
  })

  it('returns the identical message for an unknown account', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `ghost-${stamp}@cbt.test`, password: 'WrongPass1' })

    expect(response.status).toBe(401)
    // Identical wording: the endpoint must not reveal whether an account exists.
    expect(response.body.message).toBe('Invalid email or password')
  })

  it('refuses an inactive account even with the correct password', async () => {
    const email = `inactive-${stamp}@cbt.test`
    const role = await prisma.role.findUnique({ where: { code: ROLE_CODES.LECTURER } })

    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(PASSWORD),
        firstName: 'Ivan',
        lastName: 'Inactive',
        status: 'INACTIVE',
        roleId: role!.id,
      },
    })

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })

    expect(response.status).toBe(401)
    // Still generic: a correct password must not be distinguishable from a wrong one.
    expect(response.body.message).toBe('Invalid email or password')

    await prisma.user.delete({ where: { email } })
  })

  it('issues an access token and a refresh token on success', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: invigilator.email, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(typeof response.body.data.accessToken).toBe('string')
    expect(typeof response.body.data.refreshToken).toBe('string')
    expect(response.body.data.tokenType).toBe('Bearer')
  })

  it('never returns the password hash', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: invigilator.email, password: PASSWORD })

    expect(JSON.stringify(response.body)).not.toContain('passwordHash')
    expect(response.body.data.user.passwordHash).toBeUndefined()
  })

  it('validates the request body before touching the database', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: '', password: '' })

    expect(response.status).toBe(422)
    expect(response.body.errors).toHaveProperty('email')
    expect(response.body.errors).toHaveProperty('password')
  })

  it('records the sign-in in the audit trail', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: invigilator.email, password: PASSWORD })

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'LOGIN', actor: { email: invigilator.email } },
      orderBy: { createdAt: 'desc' },
    })

    expect(entry).not.toBeNull()
    expect(entry?.success).toBe(true)
  })
})

describe('token lifecycle', () => {
  it('rejects a missing token with 401', async () => {
    const response = await request(app).get('/api/v1/students')
    expect(response.status).toBe(401)
  })

  it('rejects a malformed token with 401', async () => {
    const response = await request(app)
      .get('/api/v1/students')
      .set('Authorization', 'Bearer not.a.jwt')

    expect(response.status).toBe(401)
  })

  it('returns the caller identity from /auth/me', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${invigilatorToken}`)

    expect(response.status).toBe(200)
    expect(response.body.data.email).toBe(invigilator.email)
    expect(response.body.data.role).toBe(ROLE_CODES.INVIGILATOR)
  })

  it('rotates the refresh token and rejects the replayed one', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: invigilator.email, password: PASSWORD })

    const original = login.body.data.refreshToken

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: original })

    expect(refreshed.status).toBe(200)
    expect(refreshed.body.data.refreshToken).not.toBe(original)

    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: original })

    expect(replay.status).toBe(401)
  })

  it('accepts a bare logout with no request body', async () => {
    // Express 5 leaves req.body undefined for a bodyless POST.
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${invigilatorToken}`)

    expect(response.status).toBe(200)
  })
})

/* -------------------------------------------------------------------------- */
/* Authorisation                                                               */
/* -------------------------------------------------------------------------- */

describe('authorisation', () => {
  it('allows a permitted read', async () => {
    const response = await request(app)
      .get('/api/v1/students')
      .set('Authorization', `Bearer ${invigilatorToken}`)

    // Invigilators hold students.read.
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.data)).toBe(true)
  })

  it('refuses a write the role does not hold, with 403 not 401', async () => {
    const response = await request(app)
      .post('/api/v1/students')
      .set('Authorization', `Bearer ${invigilatorToken}`)
      .send({ studentId: `NOPE-${stamp}`, firstName: 'No', lastName: 'Access', program: 'X' })

    // Authenticated but not permitted: 403 distinguishes this from 401.
    expect(response.status).toBe(403)
    expect(response.body.success).toBe(false)
  })

  it('refuses staff administration to a lecturer', async () => {
    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${lecturerToken}`)

    expect(response.status).toBe(403)
  })

  it('refuses the audit trail to a lecturer', async () => {
    const response = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${lecturerToken}`)

    expect(response.status).toBe(403)
  })

  it('refuses question creation to an invigilator', async () => {
    const response = await request(app)
      .post('/api/v1/questions')
      .set('Authorization', `Bearer ${invigilatorToken}`)
      .send({ type: 'TRUE_FALSE', stem: 'x', correctAnswer: 'TRUE' })

    expect(response.status).toBe(403)
  })

  it('refuses exam publication to a lecturer', async () => {
    const response = await request(app)
      .post('/api/v1/exams/00000000-0000-4000-8000-000000000000/publish')
      .set('Authorization', `Bearer ${lecturerToken}`)

    // Permission is checked before existence, so this is 403 not 404.
    expect(response.status).toBe(403)
  })

  it('keeps the health endpoint reachable without any token', async () => {
    const response = await request(app).get('/api/v1/health')

    expect(response.status).toBe(200)
    expect(response.body.database).toBe('connected')
  })

  it('returns 404 with the standard envelope for an unknown route', async () => {
    // Authenticated: the request reaches route matching and falls through to the
    // not-found handler. An anonymous caller is refused with 401 *before* route
    // matching, so the 404 path never reveals which routes exist to outsiders.
    const response = await request(app)
      .get('/api/v1/does-not-exist')
      .set('Authorization', `Bearer ${invigilatorToken}`)

    expect(response.status).toBe(404)
    expect(response.body.success).toBe(false)
    expect(typeof response.body.message).toBe('string')
  })

  it('refuses an unknown route anonymously with 401 rather than 404', async () => {
    const response = await request(app).get('/api/v1/does-not-exist')
    expect(response.status).toBe(401)
  })
})