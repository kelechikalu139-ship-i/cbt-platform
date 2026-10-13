import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

const url = new URL(process.env.DATABASE_URL ?? 'mysql://cbt:cbtpass@127.0.0.1:3306/cbt_system')
const adapter = new PrismaMariaDb({
  host: url.hostname || '127.0.0.1',
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.replace(/^\//, '')),
})
const prisma = new PrismaClient({ adapter })

async function main() {
  const total = await prisma.student.count()
  const live = await prisma.student.count({ where: { deletedAt: null } })
  const softDeleted = await prisma.student.findMany({
    where: { deletedAt: { not: null } },
    select: { studentId: true, firstName: true, lastName: true, deletedAt: true },
    orderBy: { deletedAt: 'desc' },
    take: 50,
  })

  console.log(`TOTAL student rows (incl. soft-deleted): ${total}`)
  console.log(`LIVE (deletedAt = null): ${live}`)
  console.log(`SOFT-DELETED: ${softDeleted.length}`)
  for (const s of softDeleted) {
    console.log(`  ${s.studentId}  ${s.firstName} ${s.lastName}  deletedAt=${s.deletedAt?.toISOString()}`)
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
