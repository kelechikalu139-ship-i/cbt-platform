import { createServer, type Server } from 'node:http'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { disconnectDatabase, verifyDatabaseConnection } from './config/database.js'

/**
 * Process entry point.
 *
 * Responsibilities, in order:
 *   1. Prove the database is reachable before accepting a single request (§7).
 *   2. Listen on the configured interface — `0.0.0.0` so student PCs on the LAN
 *      can reach the server (§34).
 *   3. Shut down cleanly on SIGINT/SIGTERM (§37).
 *
 * Kept small on purpose. Everything else lives in modules.
 */

/** How long to let in-flight requests finish before forcing the socket closed. */
const SHUTDOWN_TIMEOUT_MS = 15_000

let server: Server | undefined
let shuttingDown = false

async function start(): Promise<void> {
  // Fail fast: a server that cannot reach MariaDB must not accept traffic, or
  // every request would fail with a 503 while an operator believed it was up.
  await verifyDatabaseConnection()

  const app = createApp()

  server = createServer(app)

  // A slow-loris style client must not be able to hold a socket open forever.
  server.headersTimeout = 20_000
  server.requestTimeout = 60_000
  server.keepAliveTimeout = 15_000

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(env.PORT, env.HOST, () => {
      server!.removeListener('error', reject)
      resolve()
    })
  })

  const lanHint =
    env.HOST === '0.0.0.0'
      ? ` reachable on http://<this-machine-ip>:${env.PORT}/api/v1`
      : ` bound to ${env.HOST}`

  logger.info(
    {
      port: env.PORT,
      host: env.HOST,
      environment: env.NODE_ENV,
      pid: process.pid,
    },
    `${env.APP_NAME} v${env.APP_VERSION} listening — ${lanHint}`,
  )
}

/**
 * Graceful shutdown (§37).
 *
 * Order matters: stop accepting connections, let in-flight requests drain, then
 * close the database pool. Closing the pool first would fail every request that
 * was still running.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    logger.warn({ signal }, 'shutdown already in progress')
    return
  }
  shuttingDown = true

  logger.info({ signal }, 'shutting down')

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()

  try {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve())
        // Idle keep-alive sockets would otherwise hold `close()` open until they
        // time out, delaying shutdown by up to keepAliveTimeout per socket.
        server!.closeIdleConnections?.()
      })
    }

    await disconnectDatabase()

    logger.info('shutdown complete')
    clearTimeout(forceExit)
    process.exit(0)
  } catch (error) {
    logger.error({ err: error }, 'error during shutdown')
    process.exit(1)
  }
}

// SIGINT is Ctrl+C on a Windows console; SIGTERM is what a Windows service or
// `taskkill` sends. Both must exit cleanly.
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection')
})

process.on('uncaughtException', (error) => {
  // The process state is unknown after this point, so log and exit rather than
  // continue serving requests from a possibly corrupt runtime.
  logger.fatal({ err: error }, 'uncaught exception, exiting')
  void shutdown('uncaughtException').finally(() => process.exit(1))
})

start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start server')
  process.exit(1)
})