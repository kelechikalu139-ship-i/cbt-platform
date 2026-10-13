import request from 'supertest'
import { createApp } from '../src/app.js'

const app = createApp()
await request(app).get('/api/v1/health')

const apiLayer = (app as unknown as { router: { stack: Array<Record<string, unknown>> } }).router.stack.find(
  (l) => l.name === 'router',
)

const matchers = apiLayer?.matchers as RegExp[]
process.stdout.write(`apiLayer path=${JSON.stringify(apiLayer?.path)} src=${matchers?.[0]?.source}\n`)

const inner = (apiLayer?.handle as { stack: Array<Record<string, unknown>> }).stack
for (const layer of inner.filter((l) => l.name === 'router')) {
  const m = layer.matchers as RegExp[]
  process.stdout.write(`  inner name=${layer.name} src=${m?.[0]?.source} path=${JSON.stringify(layer.path)}\n`)
}
process.exit(0)