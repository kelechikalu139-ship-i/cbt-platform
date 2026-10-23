import express, { type Application } from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import cors from 'cors'
import helmet from 'helmet'
import { randomUUID } from 'node:crypto'
import { env, isProduction } from './config/env.js'
import { createRequestLogger } from './config/logger.js'
import { pinoHttp } from 'pino-http'
import { apiRouter } from './routes/index.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'
import { globalLimiter } from './middleware/rate-limit.js'

/**
 * Express application assembly (§19).
 *
 * Exported as a factory rather than a module-level singleton so tests can build an
 * isolated app with its own middleware stack.
 */
export function createApp(): Application {
  const app = express()
  const studentAppIndex = resolve(env.STUDENT_APP_DIR, 'index.html')
  const adminAppIndex = resolve(env.ADMIN_APP_DIR, 'index.html')
  const hasStudentApp = existsSync(studentAppIndex)
  const hasAdminApp = existsSync(adminAppIndex)

  // The server sits behind no proxy in a school LAN, so `req.ip` is the real
  // client address. Trusting X-Forwarded-For here would let any student spoof
  // their source address and defeat the rate limiter.
  app.set('trust proxy', false)

  app.disable('x-powered-by')

  // --- Security headers --------------------------------------------------
  app.use(
    helmet({
      // This process only ever serves JSON; a restrictive default-src costs
      // nothing and removes any chance of injected script executing.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // The API is not the origin of the HTML app, so cross-origin resource
      // sharing of its own assets is never needed.
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  )

  // --- CORS --------------------------------------------------------------
  // Only the listed origins may call the API from a browser (§19). This is
  // the admin app's dev server during development and the LAN address in
  // production.
  //
  // In development the Vite dev server runs on an ephemeral port
  // (`strictPort: false`), so the exact origin cannot be predicted. Any
  // loopback origin (localhost / 127.0.0.1 / ::1, any port) is therefore
  // accepted. This loosens nothing in production: `isProduction` keeps the
  // strict, configured list on a real deployment.
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests and non-browser clients (the student app served
        // from this same host, curl, the Windows service) send no Origin header.
        if (!origin) {
          callback(null, true)
          return
        }

        if (env.CORS_ORIGIN.includes(origin)) {
          callback(null, true)
          return
        }

        // Development only: any loopback origin, on any port.
        if (!isProduction) {
          try {
            const { hostname } = new URL(origin)
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
              callback(null, true)
              return
            }
          } catch {
            // Malformed origin — fall through to the rejection below.
          }
        }

        callback(new Error('Origin not permitted by CORS policy'))
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      exposedHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  )

  // --- Request identity --------------------------------------------------
  // Correlates every log line and error response to one request, which is what
  // makes a problem on a shared lab machine diagnosable after the fact.
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id']
    const requestId = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID()
    req.requestId = requestId
    res.setHeader('X-Request-Id', requestId)
    next()
  })

  // --- Logging -----------------------------------------------------------
  app.use(pinoHttp(createRequestLogger()))

  // --- Parsing -----------------------------------------------------------
  // A modest body limit: the largest legitimate request is a bulk exam definition,
  // not a file upload. Upload/import endpoints get their own limit later.
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false, limit: '2mb' }))

  // --- Rate limiting -----------------------------------------------------
  app.use(globalLimiter)

  // --- Routes ------------------------------------------------------------
  app.get('/', (_req, res) => {
    if (hasStudentApp) {
      res.sendFile(studentAppIndex)
      return
    }
    res.json({
      success: true,
      data: {
        application: env.APP_NAME,
        version: env.APP_VERSION,
        api: '/api/v1',
        health: '/api/v1/health',
      },
    })
  })

  // Uploaded files (logos) are served without authentication so the student
  // application can render the school logo without a session.
  app.use('/api/v1/uploads', express.static(env.UPLOAD_DIR))

  app.use('/api/v1', apiRouter)

  // Production packages place both browser applications beside the API. The
  // student app owns `/`; staff use `/admin`. Missing builds are skipped so
  // local API-only development and tests retain their existing behavior.
  if (hasAdminApp) {
    app.use('/admin', express.static(env.ADMIN_APP_DIR, { index: 'index.html' }))
    app.use('/admin', (req, res, next) => {
      if (req.method !== 'GET') return next()
      res.sendFile(adminAppIndex)
    })
  }
  if (hasStudentApp) {
    app.use(express.static(env.STUDENT_APP_DIR, { index: 'index.html' }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
      res.sendFile(studentAppIndex)
    })
  }

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

/** Exported for the health endpoint and tests. */
export { isProduction }
