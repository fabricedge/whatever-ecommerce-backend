import { Hono } from "hono"
import { prisma } from "../lib/prisma.js"
import { authMiddleware, getUser } from "../lib/auth-middleware.js"

const cart = new Hono()

cart.get("/", authMiddleware, async (c) => {
  const user = getUser(c)
  const cartItems = await prisma.cartItem.findMany({
    where: { userId: user.userId },
    include: { product: true },
    orderBy: { product: { name: "asc" } },
  })
  return c.json({ cartItems })
})

cart.post("/", authMiddleware, async (c) => {
  const user = getUser(c)
  const { productId, quantity = 1 } = await c.req.json()

  const existing = await prisma.cartItem.findUnique({
    where: { userId_productId: { userId: user.userId, productId } },
  })

  if (existing) {
    const cartItem = await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    })
    return c.json(cartItem)
  }

  const cartItem = await prisma.cartItem.create({
    data: { userId: user.userId, productId, quantity },
  })

  return c.json(cartItem, 201)
})

cart.patch("/:itemId", authMiddleware, async (c) => {
  const user = getUser(c)
  const itemId = c.req.param("itemId")
  const { quantity } = await c.req.json()

  const cartItem = await prisma.cartItem.findFirst({
    where: { id: itemId, userId: user.userId },
  })
  if (!cartItem) return c.json({ error: "Not found" }, 404)

  const updated = await prisma.cartItem.update({
    where: { id: itemId },
    data: { quantity },
  })
  return c.json(updated)
})

cart.delete("/:itemId", authMiddleware, async (c) => {
  const user = getUser(c)
  const itemId = c.req.param("itemId")

  const cartItem = await prisma.cartItem.findFirst({
    where: { id: itemId, userId: user.userId },
  })
  if (!cartItem) return c.json({ error: "Not found" }, 404)

  await prisma.cartItem.delete({ where: { id: itemId } })
  return c.json({ success: true })
})

export default cart
