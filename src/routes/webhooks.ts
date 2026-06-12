import { Hono } from "hono"
import { getStripe } from "../lib/stripe.js"
import { prisma } from "../lib/prisma.js"

const webhooks = new Hono()

webhooks.post("/stripe", async (c) => {
  const body = await c.req.text()
  const signature = c.req.header("stripe-signature")!

  let event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return c.json({ error: "Invalid signature" }, 400)
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object
    const orderId = paymentIntent.metadata.orderId

    if (orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (order && order.status === "PENDING") {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: "PAID" },
        })

        const items = await prisma.orderItem.findMany({ where: { orderId } })
        for (const item of items) {
          await prisma.product.update({
            where: { id: item.productId },
            data: { inventory: { decrement: item.quantity } },
          })
        }
      }
    }
  }

  return c.json({ received: true })
})

export default webhooks
