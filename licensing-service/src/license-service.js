import crypto from 'node:crypto'
export const hashKey = (value) => crypto.createHash('sha256').update(value.replace(/[^a-z0-9]/gi, '').toUpperCase()).digest('hex')
export function generateActivationKey() {
  const raw = crypto.randomBytes(20).toString('hex').toUpperCase()
  return `NCBT-${raw.match(/.{1,5}/g).join('-')}`
}
export function signLicense(payload, privateKey) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.sign(null, Buffer.from(encodedPayload), privateKey).toString('base64url')
  return { payload, signature, algorithm: 'Ed25519' }
}
export function buildLicense(row, installationId, privateKey) {
  const features = typeof row.features === 'string' ? JSON.parse(row.features) : row.features
  const payload = {
    schemaVersion: 1, licenseId: row.id, institutionId: row.institution_id,
    institutionName: row.institution_name, plan: row.plan,
    maxCandidates: Number(row.max_candidates),
    issuedAt: new Date(row.issued_at).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    features, installationId
  }
  return signLicense(payload, privateKey)
}
