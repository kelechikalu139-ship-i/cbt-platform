import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

describe('same-origin browser requests', () => {
  const app = createApp()

  it('allows a school hostname without requiring it in the configured CORS list', async () => {
    const response = await request(app)
      .get('/')
      .set('Host', 'cbt-school.local:5000')
      .set('Origin', 'http://cbt-school.local:5000')

    expect(response.status).toBe(200)
  })

  it('continues to reject unapproved cross-origin requests', async () => {
    const response = await request(app)
      .get('/')
      .set('Host', 'cbt-school.local:5000')
      .set('Origin', 'https://attacker.example')

    expect(response.status).toBe(500)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})
