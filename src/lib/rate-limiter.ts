import type { Context, MiddlewareHandler } from "hono"
import type { ClientRateLimitInfo, Store } from "hono-rate-limiter"
import { rateLimiter, MemoryStore } from "hono-rate-limiter"

let _redis: Promise<import("@upstash/redis").Redis | null> | null = null
let _redisAvailable = false

async function getRedis(): Promise<import("@upstash/redis").Redis | null> {
  if (_redis !== null) {
    const r = await _redis
    return r
  }
  _redis = (async () => {
    try {
      const { Redis } = await import("@upstash/redis")
      const r = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      })
      await r.ping()
      _redisAvailable = true
      return r
    } catch {
      console.warn("[rate-limiter] Redis unavailable, falling back to MemoryStore")
      return null
    }
  })()
  return _redis
}

class UpstashRedisStore implements Store {
  windowMs: number
  prefix: string

  constructor(windowMs: number, prefix = "rl:") {
    this.windowMs = windowMs
    this.prefix = prefix
  }

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs
  }

  private prefixKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = Date.now()
    const resetTime = new Date(now + this.windowMs)
    const r = await getRedis()

    if (!r) {
      return { totalHits: 1, resetTime }
    }

    const [count] = await r.multi()
      .incr(this.prefixKey(key))
      .expire(this.prefixKey(key), Math.ceil(this.windowMs / 1000))
      .exec()

    return { totalHits: count as number, resetTime }
  }

  async decrement(key: string): Promise<void> {
    const r = await getRedis()
    if (r) await r.decr(this.prefixKey(key))
  }

  async resetKey(key: string): Promise<void> {
    const r = await getRedis()
    if (r) await r.del(this.prefixKey(key))
  }
}

function extractUserFromToken(c: Context): string | null {
  const auth = c.req.header("authorization")
  if (!auth?.startsWith("Bearer ")) return null
  try {
    const payload = auth.slice(7).split(".")[1]
    const decoded = JSON.parse(atob(payload))
    return decoded.sub || decoded.id || decoded.email || null
  } catch {
    return null
  }
}

function getClientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")
    || "unknown"
}

function keyFor(prefix: string, c: Context): string {
  const user = extractUserFromToken(c)
  return user ? `${prefix}:user:${user}` : `${prefix}:ip:${getClientIp(c)}`
}

function dynamicLimit(authed: number, anon: number): (c: Context) => number {
  return (c) => extractUserFromToken(c) ? authed : anon
}

function makeLimiter(limit: number | ((c: Context) => number), message: string, keyPrefix: string): MiddlewareHandler {
  const windowMs = 60_000
  const store = _redisAvailable ? new UpstashRedisStore(windowMs, "rl:") : new MemoryStore()

  return rateLimiter({
    windowMs,
    limit,
    message,
    statusCode: 429,
    standardHeaders: "draft-6",
    keyGenerator: (c) => keyFor(keyPrefix, c),
    store,
  })
}

let _authLimiter: MiddlewareHandler | null = null
let _uploadLimiter: MiddlewareHandler | null = null
let _generalLimiter: MiddlewareHandler | null = null

export async function authLimiter(c: Context, next: () => Promise<void>) {
  if (!_authLimiter) {
    await getRedis()
    _authLimiter = makeLimiter(dynamicLimit(60, 15), "Muitas tentativas de autenticação. Tente novamente em 1 minuto.", "auth")
  }
  return _authLimiter(c, next)
}

export async function uploadLimiter(c: Context, next: () => Promise<void>) {
  if (!_uploadLimiter) {
    await getRedis()
    _uploadLimiter = makeLimiter(10, "Limite de uploads atingido. Tente novamente em 1 minuto.", "upload")
  }
  return _uploadLimiter(c, next)
}

export async function generalLimiter(c: Context, next: () => Promise<void>) {
  const token = c.req.header("x-internal-token")
  if (token && token === process.env.INTERNAL_API_TOKEN) {
    return next()
  }
  if (!_generalLimiter) {
    await getRedis()
    _generalLimiter = makeLimiter(dynamicLimit(300, 120), "Muitas requisições. Tente novamente mais tarde.", "general")
  }
  return _generalLimiter(c, next)
}
