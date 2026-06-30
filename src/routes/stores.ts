import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"
import { checkDeployment, buildStoreUrl } from "../lib/deployment.js"
import { logAudit } from "../lib/audit-log.js"


const stores = new Hono()

// List stores for the current user (SUPER_ADMIN sees all)
stores.get("/", authMiddleware, async (c) => {
  const user = getUser(c)

  if (user.role === "SUPER_ADMIN") {
    const list = await getPrisma().store.findMany({
      where: { id: { not: "global" } },
      orderBy: { createdAt: "desc" },
    })
    return c.json({ stores: list })
  }

  const memberships = await getPrisma().userStore.findMany({
    where: { userId: user.userId },
    include: { store: true },
  })
  return c.json({ stores: memberships.map((m) => m.store) })
})

// Return first active DEFAULT store (public fallback for stfront.fskk.site)
stores.get("/default", async (c) => {
  const store = await getPrisma().store.findFirst({
    where: { isActive: true, storefrontType: "DEFAULT", id: { not: "global" } },
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  })
  if (!store) return c.json({ error: "No default store found" }, 404)
  return c.json(store)
})

// Lookup store by domain (public) — MUST be before /:id to avoid param capture
stores.get("/lookup", async (c) => {
  const domain = c.req.query("domain")
  if (!domain) return c.json({ error: "domain query parameter is required" }, 400)

  const store = await getPrisma().store.findFirst({
    where: { domain, id: { not: "global" } },
  })
  if (!store) return c.json({ error: "No store found for this domain" }, 404)

  return c.json({ id: store.id, name: store.name, slug: store.slug, isActive: store.isActive })
})

// Get current user's plan and store usage
stores.get("/my-usage", authMiddleware, async (c) => {
  const user = getUser(c)
  const myUser = await getPrisma().user.findUnique({
    where: { id: user.userId },
    select: { plan: true },
  })
  const storeCount = await getPrisma().userStore.count({ where: { userId: user.userId } })
  const plan = myUser?.plan || "FREE"
  const limits: Record<string, number | null> = { FREE: 3, MONTHLY: 10, CUSTOM: null }
  return c.json({ plan, storeCount, limit: limits[plan] })
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
    return c.json({
      error: "Admins must submit a store request instead",
      action: "use POST /api/store-requests",
    }, 403)
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  const store = await getPrisma().store.create({
    data: { name, slug },
  })

  await getPrisma().userStore.create({
    data: { userId: user.userId, storeId: store.id },
  })

  await logAudit(c, "store.create", "Store", store.id, {
    storeName: store.name,
    storeSlug: store.slug,
    description: `Loja "${store.name}" criada`,
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
  if (body.deploymentUrl !== undefined) data.deploymentUrl = body.deploymentUrl
  if (body.domain !== undefined) data.domain = body.domain

  const updated = await getPrisma().store.update({
    where: { id },
    data,
  })

  if (user.role === "SUPER_ADMIN" && (body.isActive !== undefined || body.name !== undefined)) {
    await logAudit(c, "store.update", "Store", id, {
      changes: data,
      description: body.isActive !== undefined
        ? `Loja "${store.name}" ${body.isActive ? "ativada" : "desativada"}`
        : `Loja "${store.name}" atualizada`,
    })
  }

  return c.json(updated)
})

// Check if a store has a deployment token (public, for token gate)
stores.get("/:id/has-token", async (c) => {
  const id = c.req.param("id")!
  const store = await getPrisma().store.findUnique({
    where: { id },
    select: { deploymentToken: true },
  })
  return c.json({ hasToken: !!store?.deploymentToken })
})

// Update store domain (super admin only)
stores.put("/:id/domain", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const body = await c.req.json()
  const domain: string | null = body.domain || null

  const store = await getPrisma().store.findUnique({ where: { id } })
  if (!store) return c.json({ error: "Store not found" }, 404)

  if (domain) {
    const existing = await getPrisma().store.findFirst({
      where: { domain, id: { not: id } },
    })
    if (existing) return c.json({ error: "Domain already in use" }, 409)
  }

  const updated = await getPrisma().store.update({
    where: { id },
    data: { domain },
  })

  await logAudit(c, "store.domain.update", "Store", id, {
    before: { domain: store.domain },
    after: { domain: updated.domain },
    description: `Domínio alterado de "${store.domain || "nenhum"}" para "${updated.domain || "nenhum"}"`,
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

// Check deployment status for a store
stores.post("/:id/check-deployment", authMiddleware, async (c) => {
  const user = getUser(c)
  const id = c.req.param("id")!

  const store = await getPrisma().store.findUnique({ where: { id } })
  if (!store) return c.json({ error: "Store not found" }, 404)

  if (user.role !== "SUPER_ADMIN") {
    const membership = await getPrisma().userStore.findUnique({
      where: { userId_storeId: { userId: user.userId, storeId: id } },
    })
    if (!membership) return c.json({ error: "Forbidden" }, 403)
  }

  const url = store.deploymentUrl || buildStoreUrl(store.slug)
  const status = await checkDeployment(url)

  await getPrisma().store.update({
    where: { id },
    data: { deploymentStatus: status },
  })

  return c.json({ deploymentUrl: url, deploymentStatus: status })
})

export default stores
