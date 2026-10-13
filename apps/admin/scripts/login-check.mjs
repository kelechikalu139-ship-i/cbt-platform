/**
 * Focused check of the sign-in form's submit path in real-API mode with no
 * backend listening: the form must surface a readable error and must not throw
 * an unhandled rejection or leave the button stuck in a loading state.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => existsSync(p))

const profile = mkdtempSync(join(tmpdir(), 'cbt-login-'))
const PORT = 9334
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
)
const cleanup = () => {
  try { chrome.kill() } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
process.on('exit', cleanup)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl = null
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    wsUrl = (await res.json()).webSocketDebuggerUrl
    if (wsUrl) break
  } catch {}
  await sleep(250)
}

const socket = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  socket.addEventListener('open', res, { once: true })
  socket.addEventListener('error', rej, { once: true })
})

let nextId = 1
const pending = new Map()
const errors = []
socket.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  }
})
const send = (method, params = {}, sessionId) => {
  const id = nextId++
  return new Promise((res) => { pending.set(id, res); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) })
}
const evaluate = async (expression, sessionId) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description)
  return r.result?.result?.value
}

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' })
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)

await send('Page.navigate', { url: 'http://localhost:5175/login' }, sessionId)
await sleep(2500)

const before = await evaluate(`(() => ({
  hasForm: !!document.querySelector('form'),
  inputs: document.querySelectorAll('input').length,
  buttonDisabled: document.querySelector('button[type=submit]')?.disabled ?? null,
}))()`, sessionId)

// Fill via the native setter so React picks up the change, then submit.
await evaluate(`(() => {
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const [u, p] = document.querySelectorAll('input')
  setValue(u, 'admin')
  setValue(p, 'password123')
  return true
})()`, sessionId)

await sleep(400)
const filled = await evaluate(`(() => [...document.querySelectorAll('input')].map((i) => i.value))()`, sessionId)

await evaluate(`(() => { document.querySelector('form').requestSubmit(); return true })()`, sessionId)
await sleep(3000)

const after = await evaluate(`(() => {
  const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
  const btn = document.querySelector('button[type=submit]')
  return {
    text,
    buttonDisabled: btn?.disabled ?? null,
    buttonLabel: btn?.innerText?.trim() ?? null,
    hasAlert: !!document.querySelector('[role=alert]'),
    stillOnLogin: location.pathname === '/login',
  }
})()`, sessionId)

console.log('inputs found      :', before.inputs)
console.log('values after fill :', JSON.stringify(filled))
console.log('still on /login   :', after.stillOnLogin)
console.log('button disabled   :', after.buttonDisabled, `(label: ${JSON.stringify(after.buttonLabel)})`)
console.log('alert present     :', after.hasAlert)
console.log('visible text      :', after.text.slice(0, 200))
console.log('uncaught errors   :', errors.length ? errors : 'none')

const ok =
  before.inputs === 2 &&
  filled[0] === 'admin' &&
  filled[1] === 'password123' &&
  after.stillOnLogin &&
  after.buttonDisabled === false &&
  errors.length === 0

console.log(`\n${ok ? 'PASS' : 'FAIL'}: failed sign-in is handled gracefully\n`)
socket.close()
cleanup()
process.exit(ok ? 0 : 1)
