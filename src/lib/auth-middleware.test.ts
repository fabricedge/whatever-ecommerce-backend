import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

const TEST_SECRET = 'test-secret-key-do-not-use-in-production'
process.env.JWT_SECRET = TEST_SECRET

beforeEach(() => {
  vi.restoreAllMocks()
})

async function loadAuth() {
  return import('./auth-middleware')
}

async function loadJwt() {
  return import('./jwt')
}

describe('authMiddleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const { authMiddleware } = await loadAuth()
    const app = new Hono()
    app.use('/protected', authMiddleware)
    app.get('/protected', (c) => c.json({ ok: true }))

    const res = await app.request('/protected')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when header is not Bearer', async () => {
    const { authMiddleware } = await loadAuth()
    const app = new Hono()
    app.use('/protected', authMiddleware)
    app.get('/protected', (c) => c.json({ ok: true }))

    const res = await app.request('/protected', { headers: { Authorization: 'Basic xyz' } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token is invalid', async () => {
    const { authMiddleware } = await loadAuth()
    const app = new Hono()
    app.use('/protected', authMiddleware)
    app.get('/protected', (c) => c.json({ ok: true }))

    const res = await app.request('/protected', { headers: { Authorization: 'Bearer bad-token' } })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid token')
  })

  it('sets user context and calls next for valid token', async () => {
    const { signToken } = await loadJwt()
    const { authMiddleware, getUser } = await loadAuth()
    const token = await signToken({ userId: '1', role: 'ADMIN', email: 'admin@test.com' })

    const app = new Hono()
    app.use('/protected', authMiddleware)
    app.get('/protected', (c) => {
      const user = getUser(c)
      return c.json({ userId: user.userId, role: user.role })
    })

    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('1')
    expect(body.role).toBe('ADMIN')
  })
})

describe('adminMiddleware', () => {
  it('returns 403 when user is not ADMIN', async () => {
    const { signToken } = await loadJwt()
    const { authMiddleware, adminMiddleware, getUser } = await loadAuth()
    const token = await signToken({ userId: '2', role: 'USER', email: 'user@test.com' })

    const app = new Hono()
    app.use('/admin', authMiddleware, adminMiddleware)
    app.get('/admin', (c) => c.json({ ok: true }))

    const res = await app.request('/admin', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')
  })

  it('passes through for ADMIN role', async () => {
    const { signToken } = await loadJwt()
    const { authMiddleware, adminMiddleware } = await loadAuth()
    const token = await signToken({ userId: '1', role: 'ADMIN', email: 'admin@test.com' })

    const app = new Hono()
    app.use('/admin', authMiddleware, adminMiddleware)
    app.get('/admin', (c) => c.json({ ok: true }))

    const res = await app.request('/admin', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
