/**
 * Startup connectivity probe.
 *
 * Not part of the application — a scratch script used during development to
 * prove that env validation, the Pino logger and the Prisma/MariaDB adapter all
 * work together against the real database.
 *
 * Run with: npx tsx scripts/check-db.ts
 */
import { verifyDatabaseConnection, prisma, disconnectDatabase, isConnectionError } from '../src/config/database.js'
import { env } from '../src/config/env.js'

async function main() {
  console.log('--- env ---')
  console.log('NODE_ENV   :', env.NODE_ENV)
  console.log('PORT       :', env.PORT)
  console.log('HOST       :', env.HOST)
  console.log('DATABASE   :', env.DATABASE_URL.replace(/:[^:@/]*@/, ':***@'))
  console.log('CORS_ORIGIN:', env.CORS_ORIGIN.join(', '))

  console.log('--- database ---')
  await verifyDatabaseConnection()

  const [roles, permissions, users, categories] = await Promise.all([
    prisma.role.count(),
    prisma.permission.count(),
    prisma.user.count(),
    prisma.category.count(),
  ])

  console.log('roles      :', roles)
  console.log('permissions:', permissions)
  console.log('users      :', users)
  console.log('categories :', categories)

  console.log('\nOK')
}

main()
  .catch((error: unknown) => {
    console.error('\nFAILED')
    if (isConnectionError(error)) {
      console.error('Database is unreachable. Is MariaDB running and DATABASE_URL correct?')
    }
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })