import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"

const stores = new Hono()

// List stores for the current user (SUPER_ADMIN sees all)
stores.get("/", authMiddleware, async (c) => {
  const user = getUser(c)

  if (user.role === "SUPER_ADMIN") {
    const list = await getPrisma().store.findMany({ orderBy: { createdAt: "desc" } })
    return c.json({ stores: list })
  }

  const memberships = await getPrisma().userStore.findMany({
    where: { userId: user.userId },
    include: { store: true },
  })
  return c.json({ stores: memberships.map((m) => m.store) })
})

// Get single store
stores.get("/:id", authMiddleware, async (c) => {
  const user = getUser(c)
  const id = c.req.param("id")!!

  const store = await getPrisma().store.findUnique({ where: { id } })
  if (!store) return c.json({ error: "Store not found" }, 404)

  if (user.role !== "SUPER_ADMIN") {
    const membership = await getPrisma().userStore.findUnique({
      where: { userId_storeId: { userId: user.userId, storeId: id } },
    })
    if (!membership) return c.json({ error: "Forbidden" }, 403)
  }

  return c.json(store)
})

// Create store (SUPER_ADMIN always; ADMIN only if multi_store_enabled)
stores.post("/", authMiddleware, adminMiddleware, async (c) => {
  const user = getUser(c)
  const body = await c.req.json()
  const name: string = body.name || "Nova Loja"

  if (user.role !== "SUPER_ADMIN") {
    const globalSetting = await getPrisma().setting.findUnique({
      where: { storeId_key: { storeId: "global", key: "multi_store_enabled" } },
    })
    if (globalSetting?.value !== "true") {
      return c.json({ error: "Multi-store feature is not enabled" }, 403)
    }

    const userPermission = await getPrisma().setting.findUnique({
      where: { storeId_key: { storeId: "global", key: `user:${user.userId}:can_create_stores` } },
    })
    if (userPermission?.value !== "true") {
      return c.json({ error: "You don't have permission to create stores" }, 403)
    }
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  const store = await getPrisma().store.create({
    data: { name, slug },
  })

  await getPrisma().userStore.create({
    data: { userId: user.userId, storeId: store.id },
  })

  return c.json(store, 201)
})

// Update store
stores.put("/:id", authMiddleware, async (c) => {
  const user = getUser(c)
  const id = c.req.param("id")!
  const body = await c.req.json()

  const store = await getPrisma().store.findUnique({ where: { id } })
  if (!store) return c.json({ error: "Store not found" }, 404)

  if (user.role !== "SUPER_ADMIN") {
    const membership = await getPrisma().userStore.findUnique({
      where: { userId_storeId: { userId: user.userId, storeId: id } },
    })
    if (!membership) return c.json({ error: "Forbidden" }, 403)
  }

  const data: Record<string, any> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.isActive !== undefined) data.isActive = body.isActive

  const updated = await getPrisma().store.update({
    where: { id },
    data,
  })

  return c.json(updated)
})

// Public: get branding for a store
stores.get("/:id/branding", async (c) => {
  const id = c.req.param("id")!!

  const store = await getPrisma().store.findUnique({ where: { id } })
  if (!store || !store.isActive) return c.json({ error: "Store not found" }, 404)

  const settings = await getPrisma().setting.findMany({
    where: { storeId: id, key: { startsWith: "branding_" } },
  })

  const branding: Record<string, string> = {}
  for (const s of settings) {
    branding[s.key.replace("branding_", "")] = s.value
  }

  return c.json({
    store: { name: store.name, slug: store.slug },
    branding,
  })
})

// Update branding (admin / store owner)
stores.put("/:id/branding", authMiddleware, async (c) => {
  const user = getUser(c)
  const id = c.req.param("id")!
  const body = await c.req.json()

  const store = await getPrisma().store.findUnique({ where: { id } })
  if (!store) return c.json({ error: "Store not found" }, 404)

  if (user.role !== "SUPER_ADMIN") {
    const membership = await getPrisma().userStore.findUnique({
      where: { userId_storeId: { userId: user.userId, storeId: id } },
    })
    if (!membership) return c.json({ error: "Forbidden" }, 403)
  }

  const brandingKeys = ["primary_color", "secondary_color", "logo_url", "favicon_url", "font_family"]
  const entries: { storeId: string; key: string; value: string }[] = []
  for (const k of brandingKeys) {
    if (body[k] !== undefined) {
      entries.push({ storeId: id, key: `branding_${k}`, value: String(body[k]) })
    }
  }

  await Promise.all(
    entries.map((entry) =>
      getPrisma().setting.upsert({
        where: { storeId_key: { storeId: entry.storeId, key: entry.key } },
        update: { value: entry.value },
        create: entry,
      })
    )
  )

  return c.json({ success: true })
})

export default stores
