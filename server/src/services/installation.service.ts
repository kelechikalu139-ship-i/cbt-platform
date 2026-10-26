import crypto from 'node:crypto'
import { prisma } from '../config/database.js'

/** Persist one stable local identifier; never derive it from a client request. */
export async function ensureInstallationId(): Promise<string> {
  const existing = await prisma.systemSetting.findUnique({ where: { key: 'installationId' } })
  if (existing?.value) return existing.value

  const legacyLicense = await prisma.license.findFirst({ select: { installationId: true } })
  const id = legacyLicense?.installationId ?? crypto.randomUUID()
  const saved = await prisma.systemSetting.upsert({
    where: { key: 'installationId' },
    update: {},
    create: {
      key: 'installationId',
      value: id,
      valueType: 'string',
      description: 'Stable local installation identifier used for license activation',
    },
    select: { value: true },
  })
  return saved.value
}
