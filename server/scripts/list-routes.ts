/**
 * Prints the fully mounted API route table.
 *
 * Generated from the live app rather than maintained by hand, so the API
 * reference in README.md cannot silently drift away from the code (§23, §24).
 *
 *   npm run routes
 */
import type { Router as RouterType } from 'express'
// Importing the router assembly ensures every module's routes are registered on
// the router objects referenced below, even though `apiRouter` itself is not
// inspected (Express 5 does not expose mount paths usefully from its internals).
import '../src/routes/index.js'
import { authRouter } from '../src/modules/auth/auth.routes.js'
import { usersRouter } from '../src/modules/users/users.routes.js'
import { studentsRouter } from '../src/modules/students/students.routes.js'
import { categoriesRouter, subjectsRouter } from '../src/modules/categories/categories.routes.js'
import { questionsRouter } from '../src/modules/questions/questions.routes.js'
import { examsRouter } from '../src/modules/exams/exams.routes.js'
import { auditRouter, healthRouter, systemRouter } from '../src/modules/system/system.routes.js'

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> }
}

/**
 * The mount prefixes this script knows about.
 *
 * They are recovered by object identity -- each layer in `apiRouter.stack` is
 * compared against the routers imported above -- rather than by parsing Express's
 * internal layer structures, which differ between Express 4 and 5. Keeping the
 * prefixes as an explicit list next to the router references means a new mount
 * point shows up here as "UNMOUNTED" instead of silently vanishing.
 */
const KNOWN_MOUNTS: Array<{ prefix: string; router: unknown }> = [
  { prefix: '/health', router: healthRouter },
  { prefix: '/auth', router: authRouter },
  { prefix: '/users', router: usersRouter },
  { prefix: '/students', router: studentsRouter },
  { prefix: '/categories', router: categoriesRouter },
  { prefix: '/subjects', router: subjectsRouter },
  { prefix: '/questions', router: questionsRouter },
  { prefix: '/exams', router: examsRouter },
  { prefix: '/audit-logs', router: auditRouter },
  { prefix: '/system', router: systemRouter },
]

const API_PREFIX = '/api/v1'

const rows: string[] = []
const seen = new Set<unknown>()

for (const mount of KNOWN_MOUNTS) {
  const stack = (mount.router as RouterType).stack as unknown as RouteLayer[]

  for (const layer of stack) {
    if (!layer.route) {
      continue
    }

    const methods = Object.keys(layer.route.methods ?? {})
      .join(',')
      .toUpperCase()
    const path = layer.route.path

    rows.push(`${methods.padEnd(8)} ${API_PREFIX}${mount.prefix}${path === '/' ? '' : path}`)
    seen.add(mount.router)
  }
}

// A router mounted in routes/index.ts but absent from the table above would mean
// the documentation is incomplete, so report it loudly rather than quietly.
const unmounted = KNOWN_MOUNTS.filter((mount) => !seen.has(mount.router)).map((mount) => mount.prefix)

const header = rows.map((row) => row).sort()

process.stdout.write(`${header.join('\n')}\n\n${header.length} routes\n`)

if (unmounted.length > 0) {
  process.stdout.write(`\nWARNING: no routes found for mount(s): ${unmounted.join(', ')}\n`)
}