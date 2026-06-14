import { Context, Next } from "hono"
import { verifyToken, JwtPayload } from "./jwt.js"

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  try {
    const payload = await verifyToken(authHeader.slice(7))
    c.set("user", payload)
    await next()
  } catch {
    return c.json({ error: "Invalid token" }, 401)
  }
}

export async function adminMiddleware(c: Context, next: Next) {
  const user: JwtPayload | undefined = c.get("user")
  if (user?.role !== "ADMIN" && user?.role !== "SUPER_ADMIN") {
    return c.json({ error: "Forbidden" }, 403)
  }
  await next()
}

export function getUser(c: Context): JwtPayload {
  return c.get("user")!
}
