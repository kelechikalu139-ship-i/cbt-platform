import pino from 'pino'
import { env, isProduction, isTest } from './env.js'

/**
 * Application logger.
 *
 * A single Pino instance is shared by the whole process (§21). Two behaviours
 * matter here:
 *
 * 1. Redaction. Any field whose name looks like a secret is scrubbed before it
 *    can reach a log sink, so a careless `logger.info({ password })` elsewhere
 *    cannot leak credentials.
 * 2. Test silence. Under vitest the logger is muted, otherwise passing test runs
 *    drown in request logs.
 */

const redactPaths = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  '*.password',
  '*.passwordHash',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.correctAnswer',
  'body.password',
  'body.currentPassword',
  'body.newPassword',
  'body.token',
  'body.refreshToken',
]

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: {
    app: env.APP_NAME,
    version: env.APP_VERSION,
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Human-readable output for an operator working at the server PC console;
  // JSON lines once deployed, where logs are read by tooling.
  ...(env.LOG_PRETTY && !isProduction && !isTest
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app,version,env' },
        },
      }
    : {}),
})

/**
 * Express-compatible child logger factory used by pino-http.
 *
 * Redaction is inherited automatically, so request logs stay safe too.
 */
export function createRequestLogger() {
  return {
    logger,
    // Redact at the HTTP boundary as well: pino-http copies req/res headers
    // into the log line, and this is the last place they can be dropped.
    serializers: {
      req(request: {
        method?: string
        url?: string
        remoteAddress?: string
        headers?: Record<string, unknown>
      }) {
        return {
          method: request.method,
          url: request.url,
          ip: request.remoteAddress,
        }
      },
      res(reply: { statusCode?: number }) {
        return { statusCode: reply.statusCode }
      },
    },
    autoLogging: {
      ignore: (request: { url?: string }) => {
        // Health checks are polled frequently; logging them adds noise without
        // adding information.
        const url = request.url ?? ''
        return url.endsWith('/health') || url.endsWith('/system/status')
      },
    },
    customLogLevel: (_request: unknown, response: { statusCode?: number }, error: Error | undefined) => {
      if (error || (response.statusCode ?? 500) >= 500) return 'error'
      if ((response.statusCode ?? 0) >= 400) return 'warn'
      return 'info'
    },
  }
}