import bcrypt from 'bcrypt'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

async function readInput() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return JSON.parse(input)
}

const input = await readInput()
const email = String(input.email ?? '').trim().toLowerCase()
const password = String(input.password ?? '')

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('Administrator email is invalid')
}
if (password.length < 12) {
  throw new Error('Administrator password must contain at least 12 characters')
}

const serverRoot = path.resolve(input.serverRoot ?? process.cwd())
const { prisma } = await import(pathToFileURL(path.join(serverRoot, 'dist', 'config', 'database.js')))

try {
  const admin = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: { select: { code: true } } },
  })
  if (!admin) throw new Error('Administrator account was not found')
  if (admin.role.code !== 'SUPER_ADMIN') throw new Error('Account is not a super administrator')

  await prisma.user.update({
    where: { id: admin.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  })
  console.log(`Password reset for ${email}`)
} finally {
  await prisma.$disconnect()
}
