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

export default users
