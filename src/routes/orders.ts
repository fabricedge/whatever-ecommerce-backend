import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, getUser } from "../lib/auth-middleware.js"

const orders = new Hono()

orders.get("/", authMiddleware, async (c) => {
  const user = getUser(c)

  const orderList = await getPrisma().order.findMany({
    where: { userId: user.userId },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  })

  return c.json({ orders: orderList })
})

orders.get("/admin", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "ADMIN") return c.json({ error: "Forbidden" }, 403)

  const query = c.req.query()
  const page = Number(query.page) || 1
  const limit = 20
  const where = query.status && query.status !== "ALL" ? { status: query.status as any } : {}

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
  const email = c.req.query("email")
  if (!email) return c.json({ error: "Email é obrigatório" }, 400)

  const user = await getPrisma().user.findUnique({ where: { email } })
  if (!user) return c.json({ orders: [] })

  const orderList = await getPrisma().order.findMany({
    where: { userId: user.id },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  })

  return c.json({ orders: orderList })
})

orders.get("/:id", authMiddleware, async (c) => {
  const user = getUser(c)
  const id = c.req.param("id")

  const where: any = { id }
  if (user.role !== "ADMIN") where.userId = user.userId

  const order = await getPrisma().order.findUnique({
    where: { id },
    include: { items: { include: { product: true } }, user: true },
  })

  if (!order) return c.json({ error: "Not found" }, 404)
  return c.json(order)
})

export default orders
