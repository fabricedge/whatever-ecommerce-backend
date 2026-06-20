import { Hono } from "hono"
import { getStripe } from "../lib/stripe.js"
import { getPrisma } from "../lib/prisma.js"
import { tryActivateStore } from "./store-requests.js"
import type Stripe from "stripe"

const webhooks = new Hono()

async function fulfillOrder(orderId: string) {
  const order = await getPrisma().order.findUnique({ where: { id: orderId } })
  if (order && order.status === "PENDING") {
    await Promise.all([
      getPrisma().order.update({
        where: { id: orderId },
        data: { status: "PAID" },
      }),
      getPrisma().orderEvent.create({
        data: { orderId, fromStatus: "PENDING", toStatus: "PAID" },
      } as any),
    ])

    const items = await getPrisma().orderItem.findMany({ where: { orderId } })
    for (const item of items) {
      await getPrisma().product.update({
        where: { id: item.productId },
        data: { inventory: { decrement: item.quantity } },
      })
    }
  }
}

async function saveShippingAddress(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.orderId
  if (!orderId) return

  const s = session as any
  const shipping = s.shipping_details
  if (!shipping?.address) return

  const address = shipping.address
  const line1 = address.line1 || ""
  const line2 = address.line2 ? `, ${address.line2}` : ""

  await getPrisma().order.update({
    where: { id: orderId },
    data: {
      shippingName: shipping.name || null,
      shippingPhone: s.phone_number_collection?.phone_number || null,
      shippingAddress: `${line1}${line2}`,
      shippingCity: address.city || null,
      shippingState: address.state || null,
      shippingZip: address.postal_code || null,
    },
  })
}

webhooks.post("/stripe", async (c) => {
  const body = await c.req.text()
  const signature = c.req.header("stripe-signature")!

  let event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return c.json({ error: "Invalid signature" }, 400)
  }

  // ─── Setup fee payment for store requests ───
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent

    if (pi.metadata?.type === "setup_fee" && pi.metadata?.storeRequestId) {
      const reqId = pi.metadata.storeRequestId
      await getPrisma().storeRequest.update({
        where: { id: reqId },
        data: { setupFeePaid: true },
      })
      await tryActivateStore(reqId)
    }

    const orderId = pi.metadata?.orderId
    if (orderId) await fulfillOrder(orderId)
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session
    const orderId = session.metadata?.orderId
    if (orderId) {
      await saveShippingAddress(session)
      await fulfillOrder(orderId)
    }

    // Setup fee payment via Checkout Session
    if (session.metadata?.type === "setup_fee" && session.metadata?.storeRequestId) {
      const reqId = session.metadata.storeRequestId
      const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
      const updateData: any = { setupFeePaid: true }
      if (piId) updateData.setupFeePaymentIntentId = piId
      await getPrisma().storeRequest.update({
        where: { id: reqId },
        data: updateData,
      })
      await tryActivateStore(reqId)
    }
  }

  // ─── Connect account onboarding complete ───
  if (event.type === "account.updated") {
    const account = event.data.object as any

    if (account.charges_enabled && account.payouts_enabled) {
      const storeRequest = await getPrisma().storeRequest.findFirst({
        where: { stripeConnectAccountId: account.id },
      })
      if (storeRequest) {
        await getPrisma().storeRequest.update({
          where: { id: storeRequest.id },
          data: { connectOnboardingComplete: true },
        })
        await tryActivateStore(storeRequest.id)
      }

      const store = await getPrisma().store.findFirst({
        where: { stripeConnectAccountId: account.id },
      })
      if (store) {
        await getPrisma().store.update({
          where: { id: store.id },
          data: { connectOnboardingComplete: true },
        })
      }
    }
  }

  return c.json({ received: true })
})

export default webhooks
