import { prisma } from '../src/config/database.js'

async function main() {
  const role = await prisma.role.findUnique({
    where: { code: 'SUPER_ADMIN' },
    select: { id: true },
  })

  if (!role) {
    console.log('No SUPER_ADMIN role found — nothing to clear.')
    await prisma.$disconnect()
    return
  }

  const deleted = await prisma.user.deleteMany({
    where: { roleId: role.id },
  })

  console.log(`Cleared ${deleted.count} super admin user(s). Registration is now open.`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
