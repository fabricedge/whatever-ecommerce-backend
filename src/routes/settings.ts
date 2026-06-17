import { Hono } from "hono"
import { Context } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"

const settings = new Hono()

function getStoreId(c: Context): string {
  return c.get("storeId")!
}

settings.get("/", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const all = await getPrisma().setting.findMany({ where: { storeId } })
  const result: Record<string, string> = {}
  for (const s of all) result[s.key] = s.value
  return c.json({ settings: result })
})

settings.put("/", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()

  await Promise.all(
    Object.entries(body).map(([key, value]) =>
      getPrisma().setting.upsert({
        where: { storeId_key: { storeId, key } },
        update: { value: String(value) },
        create: { storeId, key, value: String(value) },
      })
    )
  )

  return c.json({ success: true })
})

// SUPER_ADMIN only: toggle multi-store feature
settings.put("/multi-store", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const body = await c.req.json()
  const enabled = body.enabled === true

  await getPrisma().store.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", name: "Global", slug: "global", isActive: true, storefrontType: "DEFAULT" },
  })

  await getPrisma().setting.upsert({
    where: { storeId_key: { storeId: "global", key: "multi_store_enabled" } },
    update: { value: String(enabled) },
    create: { storeId: "global", key: "multi_store_enabled", value: String(enabled) },
  })

  return c.json({ multi_store_enabled: enabled })
})

// SUPER_ADMIN only: check multi-store status
settings.get("/multi-store", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const setting = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId: "global", key: "multi_store_enabled" } },
  })

  return c.json({ multi_store_enabled: setting?.value === "true" })
})

export default settings
