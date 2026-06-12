import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { getStripe } from "../lib/stripe.js"
import { authMiddleware, getUser } from "../lib/auth-middleware.js"

const checkout = new Hono()

checkout.post("/", authMiddleware, async (c) => {
  const user = getUser(c)

  const cartItems = await getPrisma().cartItem.findMany({
    where: { userId: user.userId },
    include: { product: true },
  })

  if (cartItems.length === 0) {
    return c.json({ error: "Cart is empty" }, 400)
  }

  const total = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0)

  const order = await getPrisma().order.create({
    data: {
      userId: user.userId,
      total,
      status: "PENDING",
      items: {
        create: cartItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.product.price,
        })),
      },
    },
  })

  const paymentIntent = await getStripe().paymentIntents.create({
    amount: total,
    currency: "brl",
    metadata: { orderId: order.id },
    automatic_payment_methods: { enabled: true },
  })

  await getPrisma().order.update({
    where: { id: order.id },
    data: { stripePaymentIntentId: paymentIntent.id },
  })

  await getPrisma().cartItem.deleteMany({ where: { userId: user.userId } })

  return c.json({ clientSecret: paymentIntent.client_secret, orderId: order.id })
})

export default checkout
