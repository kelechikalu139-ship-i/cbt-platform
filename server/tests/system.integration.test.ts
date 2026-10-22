import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import type { Application } from 'express'
import { createApp } from '../src/app.js'
import { prisma } from '../src/config/database.js'
import { hashPassword } from '../src/utils/password.js'
import { ROLE_CODES } from '../src/constants/permissions.js'

/**
 * Integration tests for system branding, logo upload and static serving.
 *
 * Runs the real Express app against the real database. Uploaded files land in
 * `./uploads` next to the server and are removed after the suite.
 */

let app: Application
let adminToken: string
const stamp = Date.now().toString(36)
const PASSWORD = 'IntegrationPass1'
const uploadDir = join(process.cwd(), 'uploads')
const createdFiles: string[] = []

const email = `sysadmin-${stamp}@cbt.test`

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0, 0, 0, 13, 73, 72, 68, 82, // IHDR length + type
  0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, // 1x1 RGB
  0x2d, 0x86, 0x5f, 0x9a, // IHDR CRC
  0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82, // IEND
])

function fileNameOf(logoUrl: string): string {
  return logoUrl.slice(logoUrl.lastIndexOf('/') + 1)
}

beforeAll(async () => {
  app = createApp()
  mkdirSync(uploadDir, { recursive: true })

  const role = await prisma.role.findUnique({ where: { code: ROLE_CODES.SUPER_ADMIN } })
  expect(role).not.toBeNull()

  const passwordHash = await hashPassword(PASSWORD)
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'Sys',
      lastName: 'Admin',
      roleId: role!.id,
    },
  })

  const signIn = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
  adminToken = signIn.body.data.accessToken
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
  for (const file of createdFiles) {
    try { rmSync(join(uploadDir, file), { force: true }) } catch {
      // Best-effort cleanup of test uploads.
    }
  }
  await prisma.$disconnect()
})

describe('GET /api/v1/system/branding', () => {
  it('returns public institution branding without a session', async () => {
    const response = await request(app).get('/api/v1/system/branding')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toMatchObject({
      schoolName: expect.any(String),
      schoolShortName: expect.any(String),
      primaryColor: expect.anything(),
      logoUrl: expect.anything(),
    })
  })
})

describe('POST /api/v1/system/logo', () => {
  it('rejects an unauthenticated upload', async () => {
    const response = await request(app)
      .post('/api/v1/system/logo')
      .attach('logo', png, 'logo.png')

    expect(response.status).toBe(401)
  })

  it('rejects an upload from a role without system.manage', async () => {
    const passwordHash = await hashPassword(PASSWORD)
    await prisma.user.create({
      data: {
        email: `invigilator-${stamp}@cbt.test`,
        passwordHash,
        firstName: 'Ivy',
        lastName: 'Invigilator',
        roleId: (await prisma.role.findUnique({ where: { code: ROLE_CODES.INVIGILATOR } }))!.id,
      },
    })

    const signIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `invigilator-${stamp}@cbt.test`, password: PASSWORD })
    const token = signIn.body.data.accessToken

    const response = await request(app)
      .post('/api/v1/system/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('logo', png, 'logo.png')

    expect(response.status).toBe(403)

    await prisma.user.deleteMany({ where: { email: `invigilator-${stamp}@cbt.test` } })
  })

  it('accepts a PNG image and returns its public URL', async () => {
    const response = await request(app)
      .post('/api/v1/system/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('logo', png, 'logo.png')

    expect(response.status).toBe(201)
    expect(response.body.success).toBe(true)
    expect(typeof response.body.data.logoUrl).toBe('string')
    expect(response.body.data.logoUrl).toMatch(/^\/api\/v1\/uploads\//)

    const fileName = fileNameOf(response.body.data.logoUrl)
    createdFiles.push(fileName)
    expect(existsSync(join(uploadDir, fileName))).toBe(true)
  })

  it('rejects a non-image file', async () => {
    const response = await request(app)
      .post('/api/v1/system/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('logo', Buffer.from('plain text'), 'notes.txt')

    expect(response.status).toBe(415)
  })

  it('rejects a file over the size limit', async () => {
    const oversized = Buffer.alloc(6_000_000)
    const response = await request(app)
      .post('/api/v1/system/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('logo', oversized, 'big.png')

    expect(response.status).toBe(413)
  })
})

describe('GET /api/v1/uploads/:file', () => {
  it('serves an uploaded logo with an image content type', async () => {
    const upload = await request(app)
      .post('/api/v1/system/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('logo', png, 'served.png')
    const fileName = fileNameOf(upload.body.data.logoUrl)
    createdFiles.push(fileName)

    const response = await request(app).get(`/api/v1/uploads/${fileName}`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('image/png')
    expect(response.body).toEqual(png)
  })
})
