/**
 * End-to-end sign-in check against the LIVE backend.
 *
 * `smoke.mjs` runs unauthenticated, which in real-API mode is expected to land on
 * the sign-in screen. This script closes the loop: it drives a real browser
 * through the actual form, against the actual API, and asserts that a valid
 * administrator reaches the dashboard and can load real data.
 *
 * This is the check that proves the frontend wiring is correct -- the proxy
 * target, the `/api/v1` version segment, the `{ email, password }` request body
 * and the token-carrying response envelope. Any of those being wrong turns the
 * form into a silent failure, because every layer type-checks happily.
 *
 * Prerequisites:
 *   1. Backend running and reachable        (npm run dev:server)
 *   2. Admin dev server running            (npm run dev:admin)
 *   3. apps/admin/.env with VITE_USE_MOCK=false
 *
 * Usage:
 *   node scripts/live-login-check.mjs
 *   node scripts/live-login-check.mjs --email admin@cbt.local --password Admin@12345
 *   node scripts/live-login-check.mjs --routes /,/students,/exams
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
const EMAIL = arg('email', process.env.CBT_ADMIN_EMAIL ?? 'admin@cbt.local')
const PASSWORD = arg('password', process.env.CBT_ADMIN_PASSWORD ?? 'Admin@12345')

// Routes exercised once authenticated. Each must render its own heading.
const ROUTES = arg(
  'routes',
  '/,/students,/questions,/categories,/exams,/users,/audit-logs,/system-health',
)
  .split(',')
  .filter(Boolean)

const EXPECT = {
  '/': 'Dashboard',
  '/students': 'Students',
  '/questions': 'Questions',
  '/categories': 'Categories',
  '/exams': 'Exams',
  '/users': 'Users',
  '/audit-logs': 'Audit Logs',
  '/system-health': 'System Health',
  '/results': 'Results',
  '/settings': 'Settings',
  '/nope': 'Page not found',
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

const profile = mkdtempSync(join(tmpdir(), 'cbt-live-'))
const PORT = 9336

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

let currentStage = 'startup'
const problems = []
const apiCalls = []

// Records every request the page makes to the API and how it resolved, so a
// failure can be attributed to the frontend rather than guessed at.
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.sessionId !== sessionId) return

  if (msg.method === 'Network.requestWillBeSent') {
    const { requestId, request } = msg.params
    if (request.url.includes('/api/')) {
      apiCalls.push({ requestId, stage: currentStage, url: request.url, method: request.method })
    }
  }

  if (msg.method === 'Network.responseReceived') {
    const call = apiCalls.find((c) => c.requestId === msg.params.requestId)
    if (call) call.status = msg.params.response.status
  }

  if (msg.method === 'Network.loadingFailed') {
    const call = apiCalls.find((c) => c.requestId === msg.params.requestId)
    if (call) call.failed = msg.params.errorText
  }

  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')
    if (text.includes('Download the React DevTools')) return
    if (msg.params.type === 'error') problems.push({ stage: currentStage, kind: 'console.error', text })
  }

  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    problems.push({
      stage: currentStage,
      kind: 'exception',
      text: d.exception?.description ?? d.text ?? 'unknown',
    })
  }

  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    // React Router emits 404s for navigation probes; those are not faults.
    const text = msg.params.entry.text ?? ''
    if (text.includes('Failed to load resource: the server responded with a status of 404')) return
    problems.push({ stage: currentStage, kind: 'log.error', text })
  }
})

await send('Network.enable', {}, sessionId)

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
let failed = 0

const pass = (label, detail = '') => {
  passed++
  console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`)
}
const fail = (label, detail) => {
  failed++
  console.log(`  FAIL  ${label}`)
  console.log(`        ${detail}`)
}

/* -------------------------------------------------------------------------- */
/* 1. Sign in                                                                  */
/* -------------------------------------------------------------------------- */

currentStage = 'login'
await send('Page.navigate', { url: `${BASE}/login` }, sessionId)

// Wait for the form to mount.
let formReady = false
for (let i = 0; i < 60 && !formReady; i++) {
  await sleep(250)
  formReady = await evaluate(`!!document.querySelector('#login-username')`)
}

if (!formReady) {
  fail('sign-in form renders', 'the login form never appeared')
  console.log(`\n${passed} passed, ${failed} failed\n`)
  socket.close()
  cleanup()
  process.exit(1)
}
pass('sign-in form renders')

/**
 * Sets an input's value and fires the events React listens for. Assigning
 * `.value` directly does not notify React's synthetic onChange, so the state
 * would never update and the form would submit empty.
 */
const fill = async (selector, value) =>
  evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)

await fill('#login-username', EMAIL)
await fill('#login-password', PASSWORD)
await sleep(150)

// Submit the way a user does, rather than calling the API directly.
await evaluate(`(() => {
  const form = document.querySelector('form')
  if (!form) return false
  form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }))
  return true
})()`)

const loginCall = apiCalls.find((c) => c.stage === 'login' && c.url.includes('/auth/login'))
if (!loginCall) {
  fail('login request issued', 'the form never called POST /auth/login')
} else {
  await sleep(400)
  if (loginCall.status === 200) {
    pass('login request issued', `POST ${loginCall.url.replace(BASE, '')} -> 200`)
  } else {
    fail(
      'login request issued',
      `POST ${loginCall.url.replace(BASE, '')} -> ${loginCall.status ?? 'failed: ' + loginCall.failed}`,
    )
  }
}

// Wait for the dashboard, which only mounts once the session is stored.
let landed = false
for (let i = 0; i < 80 && !landed; i++) {
  await sleep(250)
  landed = await evaluate(`(() => {
    const text = (document.body.innerText || '').toLowerCase()
    if (text.includes('sign in to manage examinations')) return false
    if (text.includes('invalid email or password')) return false
    return document.querySelectorAll('aside nav a').length > 0
  })()`)
}

const afterLogin = await evaluate(`(() => {
  const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
  const stored = localStorage.getItem('cbt-admin-auth')
  let token = null
  let user = null
  try {
    const parsed = JSON.parse(stored)
    token = parsed?.state?.token ?? null
    user = parsed?.state?.user ?? null
  } catch { /* ignore */ }
  return {
    text: text.slice(0, 200),
    navLinks: document.querySelectorAll('aside nav a').length,
    tokenStored: typeof token === 'string' && token.length > 0,
    role: user?.role ?? null,
    permissions: Array.isArray(user?.permissions) ? user.permissions.length : null,
  }
})()`)

if (landed && afterLogin.tokenStored) {
  pass(
    'session established',
    `token stored, role=${afterLogin.role}, nav=${afterLogin.navLinks}`,
  )
} else if (/invalid email or password/i.test(afterLogin.text)) {
  fail('session established', 'the API rejected the credentials')
} else {
  fail(
    'session established',
    `landed=${landed} tokenStored=${afterLogin.tokenStored} nav=${afterLogin.navLinks} text="${afterLogin.text}"`,
  )
}

// A token that is literally the old placeholder would mean the form never read
// the response and the app is trusting a constant.
if (afterLogin.tokenStored) {
  const tokenValue = await evaluate(
    `(JSON.parse(localStorage.getItem('cbt-admin-auth'))?.state?.token) ?? ''`,
  )
  if (tokenValue === 'session-token' || tokenValue === 'mock-access-token') {
    fail('real access token stored', `stored token is the placeholder "${tokenValue}"`)
  } else {
    pass('real access token stored', `len=${String(tokenValue).length}`)
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Authenticated routes                                                     */
/* -------------------------------------------------------------------------- */

for (const route of ROUTES) {
  currentStage = route
  const before = problems.length
  await send('Page.navigate', { url: `${BASE}${route}` }, sessionId)

  const wanted = EXPECT[route] ?? 'CBT System Administration'
  const wantedLiteral = JSON.stringify([wanted.toLowerCase()])

  const deadline = Date.now() + 20_000
  let settled = false
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => {
      const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
      const skeletons = document.querySelectorAll('[class*="animate-pulse"]').length
      const wanted = ${wantedLiteral}
      const ready = skeletons === 0 && text.length > 40 && wanted.some((w) => text.toLowerCase().includes(w))
      return { ready, sig: document.querySelectorAll('*').length + ':' + skeletons + ':' + text.length }
    })()`)

    if (state.ready) {
      await sleep(400)
      const again = await evaluate(`(() => {
        const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
        const skeletons = document.querySelectorAll('[class*="animate-pulse"]').length
        return document.querySelectorAll('*').length + ':' + skeletons + ':' + text.length
      })()`)
      if (again === state.sig) { settled = true; break }
    } else {
      await sleep(250)
    }
  }

  const probe = await evaluate(`(() => {
    const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
    const wanted = ${wantedLiteral}
    return {
      nodes: document.querySelectorAll('*').length,
      navLinks: document.querySelectorAll('aside nav a').length,
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('tbody tr').length,
      skeletons: document.querySelectorAll('[class*="animate-pulse"]').length,
      hasExpected: wanted.some((w) => text.toLowerCase().includes(w)),
      signIn: text.toLowerCase().includes('sign in to manage examinations'),
      text: text.slice(0, 220),
    }
  })()`)

  const routeProblems = problems.slice(before)
  const routeCalls = apiCalls.filter((c) => c.stage === route)
  const apiDetail = routeCalls.map((c) => `${c.method} ${c.url.replace(BASE, '')}->${c.status ?? 'ERR'}`)

  if (settled && probe.hasExpected && !probe.signIn && routeProblems.length === 0) {
    pass(route, `${probe.nodes} nodes tables=${probe.tables} rows=${probe.rows} ${apiDetail.join(' ')}`)
  } else {
    fail(
      route,
      `settled=${settled} expected=${wanted} present=${probe.hasExpected} bouncedToSignIn=${probe.signIn} ` +
        `api=[${apiDetail.join(' ')}] text="${probe.text}"`,
    )
    for (const p of routeProblems) console.log(`        ${p.kind}: ${p.text.slice(0, 200)}`)
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Report                                                                   */
/* -------------------------------------------------------------------------- */

const failedApi = apiCalls.filter((c) => c.failed || (c.status && c.status >= 400))
if (failedApi.length > 0) {
  console.log('\n  API calls that did not succeed:')
  for (const c of failedApi) {
    console.log(`    ${c.method} ${c.url} -> ${c.status ?? c.failed}`)
  }
}

console.log(`\n${passed} passed, ${failed} failed against ${BASE} (real API mode)\n`)
socket.close()
cleanup()
process.exit(failed > 0 ? 1 : 0)