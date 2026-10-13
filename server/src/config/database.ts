import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { env } from './env.js'
import { logger } from './logger.js'

/**
 * Prisma client lifecycle.
 *
 * Exactly one client is created per process and shared by every request (§7).
 * Creating a client per request exhausts MariaDB's connection limit long before
 * a full lab of students connects.
 *
 * Prisma 7 no longer reads the connection string from `schema.prisma`, so the
 * client is built on the MariaDB driver adapter. The URL is still the single
 * source of truth for host, port, user, password and database name.
 */

/**
 * Parse `mysql://user:password@host:port/database` into driver options.
 *
 * Parsed here rather than handed straight to the driver so a malformed URL fails
 * with a precise message at startup instead of an opaque driver error later.
 * `decodeURIComponent` is required because passwords commonly contain `@`, `:` or
 * `/`, all of which are percent-encoded inside the authority section.
 */
function parseDatabaseUrl(url: string): {
  host: string
  port: number
  user: string
  password: string
  database: string
} {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL')
  }

  if (!parsed.username || parsed.password === '') {
    throw new Error('DATABASE_URL must include a username and password')
  }

  const database = parsed.pathname.replace(/^\//, '')
  if (!database) {
    throw new Error('DATABASE_URL must include a database name')
  }

  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(database),
  }
}

const { host, port, user, password, database } = parseDatabaseUrl(env.DATABASE_URL)

const adapter = new PrismaMariaDb({
  host,
  port,
  user,
  password,
  database,
  connectionLimit: env.DATABASE_POOL_SIZE,
  connectTimeout: env.DATABASE_CONNECT_TIMEOUT_MS,
  // Prepared-statement caching is disabled: MariaDB resets prepared statements
  // whenever it upgrades a prepared-statement table, which surfaces as an
  // intermittent "prepared statement does not exist" error mid-examination.
  // Disabling it costs a negligible amount of throughput and removes an entire
  // class of hard-to-diagnose failure from a live exam.
  prepareCacheLength: 0,
})

export const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
})

// Prisma emits its own diagnostics through the client rather than the logger.
prisma.$on('warn' as never, (event: { message: string }) => {
  logger.warn({ prisma: event.message }, 'prisma warning')
})
prisma.$on('error' as never, (event: { message: string }) => {
  logger.error({ prisma: event.message }, 'prisma error')
})

/**
 * Verify the database is reachable and the schema is present.
 *
 * Called once during startup (§7, §20). A server that cannot reach MariaDB must
 * fail loudly here rather than accept traffic and fail every request.
 */
export async function verifyDatabaseConnection(): Promise<void> {
  const startedAt = Date.now()
  await prisma.$queryRawUnsafe('SELECT 1')
  logger.info(
    { host, port, database, latencyMs: Date.now() - startedAt },
    'database connection verified',
  )
}

/** True when the failure looks like the database being unreachable. */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: string }).code ?? ''
  return (
    code === 'P1001' || // can't reach database server
    code === 'P1002' || // server reached but timed out
    code === 'P1000' || // authentication failed
    code === 'P1008' || // operation timed out
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ER_ACCESS_DENIED_ERROR'
  )
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect()
    logger.info('database connection pool closed')
  } catch (error) {
    logger.error({ err: error }, 'failed to close database connection pool cleanly')
  }
}

export type DatabaseClient = typeof prisma