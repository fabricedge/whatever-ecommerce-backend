import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"

const users = new Hono()

users.get("/", authMiddleware, adminMiddleware, async (c) => {
  const query = c.req.query()
  const page = Math.max(Number(query.page) || 1, 1)
  const limit = Math.min(Number(query.limit) || 20, 100)
  const search = query.search

  const where: any = {}
  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
    ]
  }

  const [userList, count] = await Promise.all([
    getPrisma().user.findMany({
      where,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    getPrisma().user.count({ where }),
  ])

  return c.json({ users: userList, count, pages: Math.ceil(count / limit) })
})

// List ADMINS and SUPER_ADMINS with store creation permission
users.get("/admins", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const adminList = await getPrisma().user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  const globalSetting = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId: "global", key: "multi_store_enabled" } },
  })
  const multiStoreEnabled = globalSetting?.value === "true"

  const result = await Promise.all(
    adminList.map(async (a) => {
      const canCreateSetting = await getPrisma().setting.findUnique({
        where: { storeId_key: { storeId: "global", key: `user:${a.id}:can_create_stores` } },
      })
      const storeCount = await getPrisma().userStore.count({ where: { userId: a.id } })
      return {
        id: a.id,
        email: a.email,
        name: a.name,
        role: a.role,
        canCreateStores: a.role === "SUPER_ADMIN" ? true : canCreateSetting?.value === "true",
        storeCount,
        multiStoreEnabled,
      }
    })
  )

  return c.json({ users: result })
})

users.get("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param("id")!

  const user = await getPrisma().user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  })

  if (!user) return c.json({ error: "Not found" }, 404)

  const orderList = await getPrisma().order.findMany({
    where: { userId: id },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  })

  const totalSpent = orderList
    .filter((o) => ["PAID", "SHIPPED", "DELIVERED"].includes(o.status))
    .reduce((sum, o) => sum + o.total, 0)

  return c.json({
    user,
    orders: orderList,
    totalOrders: orderList.length,
    totalSpent,
  })
})

users.put("/:id/role", authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param("id")!
  const body = await c.req.json()
  const { role } = body

  if (role !== "ADMIN" && role !== "CUSTOMER") {
    return c.json({ error: "Role inválida" }, 400)
  }

  const updated = await getPrisma().user.update({
    where: { id },
    data: { role },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  })

  return c.json({ user: updated })
})

// Toggle individual store creation permission (SUPER_ADMIN only)
users.put("/:id/store-permission", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const body = await c.req.json()
  const canCreate = body.canCreateStores === true

  const targetUser = await getPrisma().user.findUnique({ where: { id } })
  if (!targetUser) return c.json({ error: "User not found" }, 404)
  if (targetUser.role === "SUPER_ADMIN") return c.json({ error: "Cannot change SUPER_ADMIN permission" }, 400)

  await getPrisma().store.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", name: "Global", slug: "global", isActive: true, storefrontType: "DEFAULT" },
  })

  await getPrisma().setting.upsert({
    where: { storeId_key: { storeId: "global", key: `user:${id}:can_create_stores` } },
    update: { value: String(canCreate) },
    create: { storeId: "global", key: `user:${id}:can_create_stores`, value: String(canCreate) },
  })

  return c.json({ canCreateStores: canCreate })
})

export default users
