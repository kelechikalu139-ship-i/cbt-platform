import crypto from 'node:crypto'
import { z } from 'zod'

export const LICENSE_PRODUCT_ID = 'nurse-cbt'

const licensePayloadSchema = z.object({
  schemaVersion: z.literal(1),
  licenseId: z.string().uuid(),
  institutionId: z.string().min(2).max(64),
  institutionName: z.string().min(2).max(190),
  product: z.literal(LICENSE_PRODUCT_ID),
  plan: z.enum(['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE']),
  maxCandidates: z.number().int().positive().max(100000),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  features: z.array(z.enum(['cbt', 'question-bank', 'results', 'excel-export', 'pdf-export', 'backup-restore', 'osce', 'viva'])).max(20),
  installationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
}).strict()

export interface SignedLicense {
  payload: unknown
  signature: string
  algorithm: string
}

export interface VerifiedLicense {
  schemaVersion: 1
  licenseId: string
  institutionId: string
  institutionName: string
  product: typeof LICENSE_PRODUCT_ID
  plan: 'TRIAL' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE'
  maxCandidates: number
  issuedAt: string
  expiresAt: string | null
  features: Array<'cbt' | 'question-bank' | 'results' | 'excel-export' | 'pdf-export' | 'backup-restore' | 'osce' | 'viva'>
  installationId: string
}

export interface LicenseVerificationOptions {
  publicKeyPem: string
  installationId: string
  now?: Date
  clockSkewMs?: number
  allowExpired?: boolean
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('License claims cannot be serialized')
  return encoded
}

/** Verify the central Ed25519 signature and all claims before local persistence. */
export function verifySignedLicense(
  signed: SignedLicense,
  options: LicenseVerificationOptions,
): VerifiedLicense {
  if (!signed || signed.algorithm !== 'Ed25519' || typeof signed.signature !== 'string') {
    throw new Error('Unsupported or malformed signed license')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(signed.signature)) {
    throw new Error('Malformed license signature')
  }

  const parsed = licensePayloadSchema.safeParse(signed.payload)
  if (!parsed.success) throw new Error('License claims are invalid')

  let publicKey: crypto.KeyObject
  try {
    publicKey = crypto.createPublicKey(options.publicKeyPem)
  } catch {
    throw new Error('License verification key is invalid')
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('License verification key must be Ed25519')
  }

  const signature = Buffer.from(signed.signature, 'base64url')
  if (signature.length !== 64) throw new Error('Malformed license signature')
  const canonicalPayload = Buffer.from(canonicalJson(parsed.data)).toString('base64url')
  const legacyPayload = Buffer.from(JSON.stringify(signed.payload)).toString('base64url')
  const valid = [canonicalPayload, legacyPayload].some((encoded) =>
    crypto.verify(null, Buffer.from(encoded), publicKey, signature),
  )
  if (!valid) {
    throw new Error('License signature is invalid')
  }

  if (parsed.data.installationId !== options.installationId) {
    throw new Error('License belongs to a different installation')
  }

  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('Verification clock is invalid')
  const clockSkewMs = options.clockSkewMs ?? 5 * 60 * 1000
  const issuedAt = Date.parse(parsed.data.issuedAt)
  if (!Number.isFinite(issuedAt) || issuedAt > now.getTime() + clockSkewMs) {
    throw new Error('License issue time is invalid')
  }
  if (parsed.data.expiresAt !== null) {
    const expiresAt = Date.parse(parsed.data.expiresAt)
    if (!Number.isFinite(expiresAt) || (!options.allowExpired && expiresAt <= now.getTime())) {
      throw new Error('License has expired')
    }
  }

  return parsed.data
}
