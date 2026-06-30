import { Hono } from "hono"
import { Context } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"

const orders = new Hono()

function getStoreId(c: Context): string {
  return c.get("storeId")!
}

async function createOrderEvent(orderId: string, fromStatus: any, toStatus: string) {
  await getPrisma().orderEvent.create({
    data: { orderId, fromStatus, toStatus } as any,
  })
}

orders.get("/", authMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const user = getUser(c)

  const orderList = await getPrisma().order.findMany({
    where: { userId: user.userId, storeId },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  })

  return c.json({ orders: orderList })
})

orders.get("/admin", authMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const user = getUser(c)
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const query = c.req.query()
  const page = Number(query.page) || 1
  const limit = 20
  const search = query.search

  const where: any = { storeId }
  if (query.status && query.status !== "ALL") where.status = query.status as any
  if (search) {
    where.OR = [
      { id: { contains: search, mode: "insensitive" } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ]
  }

  const [orderList, count] = await Promise.all([
    getPrisma().order.findMany({
      where,
      include: { items: { include: { product: true } }, user: true },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    getPrisma().order.count({ where }),
  ])

  return c.json({ orders: orderList, count, pages: Math.ceil(count / limit) })
})

orders.get("/lookup", async (c) => {
  const storeId = getStoreId(c)
  const email = c.req.query("email")
  if (!email) return c.json({ error: "Email é obrigatório" }, 400)

  const user = await getPrisma().user.findUnique({ where: { email } })
  if (!user) return c.json({ orders: [] })

  const orderList = await getPrisma().order.findMany({
    where: { userId: user.id, storeId },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  })

  return c.json({ orders: orderList })
})

orders.get("/stats", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfDay)
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const paidStatuses: ("PAID" | "SHIPPED" | "DELIVERED")[] = ["PAID", "SHIPPED", "DELIVERED"]

  const storeFilter = { storeId }

  const [
    totalRevenue,
    revenueToday,
    revenueWeek,
    revenueMonth,
    ordersByStatus,
    totalOrders,
    totalProducts,
    totalCustomers,
  ] = await Promise.all([
    getPrisma().order.aggregate({
      where: { status: { in: paidStatuses }, ...storeFilter },
      _sum: { total: true },
    }),
    getPrisma().order.aggregate({
      where: { status: { in: paidStatuses }, createdAt: { gte: startOfDay }, ...storeFilter },
      _sum: { total: true },
    }),
    getPrisma().order.aggregate({
      where: { status: { in: paidStatuses }, createdAt: { gte: startOfWeek }, ...storeFilter },
      _sum: { total: true },
    }),
    getPrisma().order.aggregate({
      where: { status: { in: paidStatuses }, createdAt: { gte: startOfMonth }, ...storeFilter },
      _sum: { total: true },
    }),
    getPrisma().order.groupBy({
      by: ["status"],
      where: storeFilter,
      _count: true,
    }),
    getPrisma().order.count({ where: storeFilter }),
    getPrisma().product.count({ where: storeFilter }),
    getPrisma().order.groupBy({
      by: ["userId"],
      where: storeFilter,
      _count: { userId: true },
    }).then((groups) => groups.length),
  ])

  return c.json({
    revenue: {
      total: totalRevenue._sum?.total ?? 0,
      today: revenueToday._sum?.total ?? 0,
      week: revenueWeek._sum?.total ?? 0,
      month: revenueMonth._sum?.total ?? 0,
    },
    ordersByStatus: ordersByStatus.map((o) => ({ status: o.status, count: o._count })),
    totalOrders,
    totalProducts,
    totalCustomers,
  })
})

orders.get("/:id", authMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const user = getUser(c)
  const id = c.req.param("id")!

  const where: any = { id, storeId }
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") where.userId = user.userId

  const order = await getPrisma().order.findUnique({
    where: { id },
    include: { items: { include: { product: true } }, user: true, events: { orderBy: { createdAt: "asc" } } },
  })

  if (!order) return c.json({ error: "Not found" }, 404)

  const originSettings = await getPrisma().setting.findMany({
    where: { storeId, key: { in: ['origin_zip', 'origin_city', 'origin_state', 'origin_country'] } },
  })
  const originMap: Record<string, string> = {}
  for (const s of originSettings) originMap[s.key] = s.value

  return c.json({
    ...order,
    originAddress: {
      zip: originMap.origin_zip || '',
      city: originMap.origin_city || '',
      state: originMap.origin_state || '',
      country: originMap.origin_country || 'US',
    },
  })
})

orders.put("/:id/status", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")!
  const body = await c.req.json()
  const status: string = body.status

  const validStatuses: string[] = ["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED"]
  if (!validStatuses.includes(status)) {
    return c.json({ error: "Status inválido" }, 400)
  }

  const order = await getPrisma().order.findUnique({ where: { id, storeId } })
  if (!order) return c.json({ error: "Not found" }, 404)

  const [updated] = await Promise.all([
    getPrisma().order.update({
      where: { id },
      data: { status: status as any },
      include: { items: { include: { product: true } }, user: true, events: { orderBy: { createdAt: "asc" } } },
    }),
    createOrderEvent(id, order.status, status),
  ])

  return c.json(updated)
})

orders.post("/bulk-status", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()
  const ids: string[] = body.ids
  const status: string = body.status

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: "IDs inválidos" }, 400)
  }

  const validStatuses: string[] = ["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED"]
  if (!validStatuses.includes(status)) {
    return c.json({ error: "Status inválido" }, 400)
  }

  const orders = await getPrisma().order.findMany({ where: { id: { in: ids }, storeId } })

  await Promise.all([
    getPrisma().order.updateMany({
      where: { id: { in: ids }, storeId },
      data: { status: status as any },
    }),
    ...orders.map((o) => createOrderEvent(o.id, o.status, status)),
  ])

  return c.json({ success: true, updated: ids.length })
})

export default orders
