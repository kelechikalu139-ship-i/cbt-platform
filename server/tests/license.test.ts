import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LICENSE_PRODUCT_ID, verifySignedLicense } from '../src/utils/license.js'
import { buildLicense } from '../../licensing-service/src/license-service.js'

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const installationId = 'a7c1b102-99e9-4e43-8db0-f83464e136bc'

function createSignedLicense(overrides: Record<string, unknown> = {}) {
  const payload = {
    schemaVersion: 1,
    licenseId: 'f69aab98-6cb5-42bf-b61f-e1482f985cda',
    institutionId: 'school-1',
    institutionName: 'Example Nursing School',
    product: LICENSE_PRODUCT_ID,
    plan: 'STANDARD',
    maxCandidates: 300,
    issuedAt: '2026-10-22T10:00:00.000Z',
    expiresAt: '2027-10-22T23:59:59.999Z',
    features: ['cbt', 'results'],
    installationId,
    ...overrides,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.sign(null, Buffer.from(encodedPayload), privateKey).toString('base64url')
  return { payload, signature, algorithm: 'Ed25519' }
}

const options = {
  publicKeyPem,
  installationId,
  now: new Date('2026-10-23T00:00:00.000Z'),
}

describe('signed local licenses', () => {
  it('accepts the claim format produced by the central licensing signer', () => {
    const signed = buildLicense({
      id: 'f69aab98-6cb5-42bf-b61f-e1482f985cda',
      institution_id: 'school-1',
      institution_name: 'Example Nursing School',
      plan: 'STANDARD',
      max_candidates: 300,
      issued_at: new Date('2026-10-22T10:00:00.000Z'),
      expires_at: new Date('2027-10-22T23:59:59.999Z'),
      features: ['cbt', 'results'],
    }, installationId, privateKey)
    expect(verifySignedLicense(signed, options).product).toBe(LICENSE_PRODUCT_ID)
  })

  it('accepts valid Ed25519 claims for this product and installation', () => {
    const verified = verifySignedLicense(createSignedLicense(), options)
    expect(verified.product).toBe(LICENSE_PRODUCT_ID)
    expect(verified.installationId).toBe(installationId)
    expect(verified.maxCandidates).toBe(300)
  })

  it('rejects a changed payload', () => {
    const signed = createSignedLicense()
    signed.payload = { ...signed.payload, maxCandidates: 100000 }
    expect(() => verifySignedLicense(signed, options)).toThrow('License signature is invalid')
  })

  it('rejects an invalid signature and non-Ed25519 algorithm', () => {
    const signed = createSignedLicense()
    signed.signature = Buffer.alloc(64).toString('base64url')
    expect(() => verifySignedLicense(signed, options)).toThrow('License signature is invalid')
    expect(() => verifySignedLicense({ ...createSignedLicense(), algorithm: 'RSA' }, options)).toThrow()
  })

  it('rejects licenses for another installation or product', () => {
    expect(() => verifySignedLicense(createSignedLicense({ installationId: 'other-installation' }), options)).toThrow('License belongs to a different installation')
    expect(() => verifySignedLicense(createSignedLicense({ product: 'other-product' }), options)).toThrow('License claims are invalid')
  })

  it('rejects expired, malformed and implausibly future issued claims', () => {
    expect(() => verifySignedLicense(createSignedLicense({ expiresAt: '2026-10-22T00:00:00.000Z' }), options)).toThrow('License has expired')
    expect(() => verifySignedLicense(createSignedLicense({ issuedAt: 'not-a-date' }), options)).toThrow('License claims are invalid')
    expect(() => verifySignedLicense(createSignedLicense({ issuedAt: '2027-01-01T00:00:00.000Z' }), options)).toThrow('License issue time is invalid')
  })

  it('accepts a correctly signed perpetual license', () => {
    const verified = verifySignedLicense(createSignedLicense({ expiresAt: null }), options)
    expect(verified.expiresAt).toBeNull()
  })
})
