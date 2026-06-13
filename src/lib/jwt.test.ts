import { describe, it, expect, beforeAll } from 'vitest'

const TEST_SECRET = 'test-secret-key-do-not-use-in-production'

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET
})

async function loadJwt() {
  return import('./jwt')
}

describe('JWT', () => {
  it('signs and verifies a token', async () => {
    const { signToken, verifyToken } = await loadJwt()
    const payload = { userId: '123', role: 'ADMIN', email: 'admin@test.com' }
    const token = await signToken(payload)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
    const decoded = await verifyToken(token)
    expect(decoded.userId).toBe('123')
    expect(decoded.role).toBe('ADMIN')
    expect(decoded.email).toBe('admin@test.com')
  })

  it('rejects an invalid token', async () => {
    const { verifyToken } = await loadJwt()
    await expect(verifyToken('invalid.token.here')).rejects.toThrow()
  })

  it('rejects a token signed with different secret', async () => {
    const { SignJWT } = await import('jose')
    const differentSecret = new TextEncoder().encode('different-secret')
    const token = await new SignJWT({ userId: '1', role: 'USER', email: 'a@b.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(differentSecret)
    const { verifyToken } = await loadJwt()
    await expect(verifyToken(token)).rejects.toThrow()
  })
})
