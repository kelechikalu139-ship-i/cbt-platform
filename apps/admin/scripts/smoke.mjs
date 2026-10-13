/**
 * Renders the admin SPA in headless Chrome and fails on any console error,
 * page error, or failed request. Catches runtime faults that typecheck, lint and
 * a successful bundle all miss.
 *
 * Usage:
 *   node scripts/smoke.mjs [--url http://localhost:5174] [--routes /,/students]
 *   node scripts/smoke.mjs --anonymous   # assert signed-out visitors are gated
 *
 * Requires a dev server already running (npm run dev); it does not start one.
 * It drives real headless Chrome over the DevTools protocol, so it needs no
 * browser automation dependency installed in the project.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}

const BASE = arg('url', 'http://localhost:5174')
const ROUTES = (arg('routes', '/,/students,/questions,/categories,/exams,/results,/users,/audit-logs,/system-health,/settings,/nope'))
  .split(',')
  .filter(Boolean)

const ANONYMOUS = args.includes('--anonymous')
const LOGIN_MARKER = 'Sign in to manage examinations'

/**
 * Per-route expectations. Each route must render its own heading, so a shell
 * that mounts but routes to the wrong page still fails, and a page that renders
 * an empty or stalled tree fails too.
 *
 * In `--anonymous` mode there is no session, so every protected route must land
 * on the sign-in screen instead of its own content.
 */
const EXPECT = {
  '/': 'Dashboard',
  '/students': 'Students',
  '/questions': 'Questions',
  '/categories': 'Categories',
  '/exams': 'Exams',
  '/results': 'Results',
  '/users': 'Users',
  '/audit-logs': 'Audit Logs',
  '/system-health': 'System Health',
  '/settings': 'Settings',
  // Mock mode auto-hydrates a session, so /login correctly bounces to the
  // dashboard; real mode with no backend shows the sign-in form instead.
  '/login': ['Sign in to manage examinations', 'Dashboard'],
  '/nope': ['Page not found'],
}

const CHROME = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => existsSync(p))

if (!CHROME) {
  console.error('No Chrome or Edge binary found.')
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'cbt-smoke-'))
const PORT = 9333

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const cleanup = () => {
  try { chrome.kill() } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
}
process.on('exit', cleanup)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Wait for the DevTools endpoint.
let wsUrl = null
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    wsUrl = (await res.json()).webSocketDebuggerUrl
    if (wsUrl) break
  } catch {
    /* not up yet */
  }
  await sleep(250)
}

if (!wsUrl) {
  console.error('Chrome DevTools endpoint did not start.')
  process.exit(2)
}

const socket = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})

function send(method, params = {}, sessionId) {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' })
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Log.enable', {}, sessionId)

let failures = 0
let currentRoute = ''

const problems = []
const warnings = []

socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.sessionId !== sessionId) return

  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')
    if (text.includes('Download the React DevTools')) return
    if (msg.params.type === 'error') problems.push({ route: currentRoute, kind: 'console.error', text })
    else if (msg.params.type === 'warning') warnings.push({ route: currentRoute, kind: 'console.warn', text })
  }

  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    problems.push({
      route: currentRoute,
      kind: 'exception',
      text: d.exception?.description ?? d.text ?? 'unknown',
    })
  }

  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push({
      route: currentRoute,
      kind: 'log.error',
      text: `${msg.params.entry.text} ${msg.params.entry.url ?? ''}`,
    })
  }
})

const evaluate = async (expression) => {
  const res = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  )
  if (res.result?.exceptionDetails) {
    throw new Error(res.result.exceptionDetails.exception?.description ?? 'evaluate failed')
  }
  return res.result?.result?.value
}

let passed = 0

for (const route of ROUTES) {
  currentRoute = route
  problems.length = 0

  await send('Page.navigate', { url: `${BASE}${route}` }, sessionId)

  const expected = ANONYMOUS
    ? [LOGIN_MARKER]
    : [].concat(EXPECT[route] ?? 'CBT System Administration')
  const expectedLiteral = JSON.stringify(expected.map((e) => e.toLowerCase()))

  // Wait for the app to settle rather than guessing with a fixed sleep: the
  // first cold load transforms every module on demand and can outlast any
  // fixed delay, which produced intermittent false failures. Settled means the
  // route's own content is present, no loading skeletons remain, and the DOM
  // signature stops changing between consecutive samples.
  const deadline = Date.now() + 25_000
  let settled = false
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => {
      const root = document.getElementById('root')
      if (!root) return { ready: false, sig: '' }
      const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
      const skeletons = document.querySelectorAll('[class*="animate-pulse"]').length
      const wanted = ${expectedLiteral}
      const sig = root.querySelectorAll('*').length + ':' + skeletons + ':' + text.length
      return {
        ready:
          root.children.length > 0 &&
          skeletons === 0 &&
          text.length > 40 &&
          wanted.some((w) => text.toLowerCase().includes(w)),
        sig,
      }
    })()`)

    if (state.ready) {
      await sleep(400)
      const again = await evaluate(`(() => {
        const root = document.getElementById('root')
        const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
        const skeletons = document.querySelectorAll('[class*="animate-pulse"]').length
        return root.querySelectorAll('*').length + ':' + skeletons + ':' + text.length
      })()`)
      if (again === state.sig) { settled = true; break }
    } else {
      await sleep(250)
    }
  }
  if (!settled) await sleep(750)

  const probe = await evaluate(`(() => {
    const root = document.getElementById('root')
    const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
    const wanted = ${expectedLiteral}
    return {
      mounted: !!(root && root.children.length),
      nodeCount: root ? root.querySelectorAll('*').length : 0,
      h1: (document.querySelector('h1') || {}).innerText || '',
      navLinks: document.querySelectorAll('aside nav a').length,
      tables: document.querySelectorAll('table').length,
      skeletonCount: document.querySelectorAll('[class*="animate-pulse"]').length,
      textLength: text.length,
      hasExpected: wanted.some((w) => text.toLowerCase().includes(w)),
      text: text.slice(0, 260),
    }
  })()`)

  const routeProblems = problems.filter((p) => p.route === route)
  const routeWarnings = warnings.filter((p) => p.route === route)

  const ok =
    probe.mounted &&
    probe.nodeCount > 20 &&
    probe.textLength > 40 &&
    probe.hasExpected &&
    probe.skeletonCount === 0 &&
    routeProblems.length === 0

  const warnTag = routeWarnings.length ? `  (${routeWarnings.length} warn)` : ''
  if (ok) {
    passed++
    console.log(
      `  PASS  ${route.padEnd(16)} ${String(probe.nodeCount).padStart(5)} nodes  nav=${probe.navLinks} tables=${probe.tables}${warnTag}`,
    )
    for (const w of routeWarnings) console.log(`        ${w.kind}: ${w.text.slice(0, 150)}`)
  } else {
    failures++
    console.log(`  FAIL  ${route}`)
    console.log(
      `        mounted=${probe.mounted} nodes=${probe.nodeCount} textLen=${probe.textLength} skeletons=${probe.skeletonCount}`,
    )
    console.log(`        expected one of ${JSON.stringify(expected)} present=${probe.hasExpected}`)
    console.log(`        text: ${probe.text}`)
    for (const p of routeProblems) console.log(`        ${p.kind}: ${p.text.slice(0, 200)}`)
  }
}

console.log(`\n${passed} passed, ${failures} failed across ${ROUTES.length} routes\n`)
socket.close()
cleanup()
process.exit(failures > 0 ? 1 : 0)
