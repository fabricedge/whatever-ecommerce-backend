import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware } from "../lib/auth-middleware.js"

const settings = new Hono()

settings.get("/", authMiddleware, adminMiddleware, async (c) => {
  const all = await getPrisma().setting.findMany()
  const result: Record<string, string> = {}
  for (const s of all) result[s.key] = s.value
  return c.json({ settings: result })
})

settings.put("/", authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json()

  await Promise.all(
    Object.entries(body).map(([key, value]) =>
      getPrisma().setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )
  )

  return c.json({ success: true })
})

export default settings
