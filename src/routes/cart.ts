import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, getUser } from "../lib/auth-middleware.js"

const cart = new Hono()

cart.get("/", authMiddleware, async (c) => {
  const user = getUser(c)
  const cartItems = await getPrisma().cartItem.findMany({
    where: { userId: user.userId },
    include: { product: true },
    orderBy: { product: { name: "asc" } },
  })
  return c.json({ cartItems })
})

cart.post("/", authMiddleware, async (c) => {
  const user = getUser(c)
  const { productId, quantity = 1 } = await c.req.json()

  const existing = await getPrisma().cartItem.findUnique({
    where: { userId_productId: { userId: user.userId, productId } },
  })

  if (existing) {
    const cartItem = await getPrisma().cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    })
    return c.json(cartItem)
  }

  const cartItem = await getPrisma().cartItem.create({
    data: { userId: user.userId, productId, quantity },
  })

  return c.json(cartItem, 201)
})

cart.patch("/:itemId", authMiddleware, async (c) => {
  const user = getUser(c)
  const itemId = c.req.param("itemId")
  const { quantity } = await c.req.json()

  const cartItem = await getPrisma().cartItem.findFirst({
    where: { id: itemId, userId: user.userId },
  })
  if (!cartItem) return c.json({ error: "Not found" }, 404)

  const updated = await getPrisma().cartItem.update({
    where: { id: itemId },
    data: { quantity },
  })
  return c.json(updated)
})

cart.delete("/:itemId", authMiddleware, async (c) => {
  const user = getUser(c)
  const itemId = c.req.param("itemId")

  const cartItem = await getPrisma().cartItem.findFirst({
    where: { id: itemId, userId: user.userId },
  })
  if (!cartItem) return c.json({ error: "Not found" }, 404)

  await getPrisma().cartItem.delete({ where: { id: itemId } })
  return c.json({ success: true })
})

export default cart
