import { Hono } from "hono"
import { Context } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { getStripe } from "../lib/stripe.js"
import { verifyToken } from "../lib/jwt.js"

const checkoutSession = new Hono()

function getStoreId(c: Context): string {
  return c.get("storeId")!
}

checkoutSession.post("/", async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()

  let email: string | undefined
  let items: { productId: string; quantity: number }[] | undefined

  const authHeader = c.req.header("Authorization")
  let tokenUser: { userId: string; role: string; email: string } | null = null
  if (authHeader?.startsWith("Bearer ")) {
    try {
      tokenUser = await verifyToken(authHeader.slice(7)) as any
    } catch {}
  }

  if (tokenUser) {
    email = tokenUser.email
    const cartItems = await getPrisma().cartItem.findMany({
      where: { userId: tokenUser.userId },
      include: { product: true },
    })
    if (cartItems.length === 0) {
      return c.json({ error: "Carrinho vazio" }, 400)
    }
    items = cartItems.map((ci) => ({ productId: ci.productId, quantity: ci.quantity }))
  } else {
    email = body.email
    items = body.items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ error: "Carrinho vazio" }, 400)
    }
    if (!email || typeof email !== "string") {
      return c.json({ error: "Email é obrigatório" }, 400)
    }
  }

  const productIds = items.map((i) => i.productId)
  const products = await getPrisma().product.findMany({
    where: { id: { in: productIds } },
  })
  const productMap = new Map(products.map((p) => [p.id, p]))

  for (const item of items) {
    const product = productMap.get(item.productId)
    if (!product) {
      return c.json({ error: `Produto não encontrado` }, 400)
    }
    if (product.inventory < item.quantity) {
      return c.json({
        error: `Estoque insuficiente para "${product.name}". Disponível: ${product.inventory}`,
      }, 400)
    }
  }

  let user = await getPrisma().user.findUnique({ where: { email } })
  if (!user) {
    user = await getPrisma().user.create({ data: { email, role: "CUSTOMER" } })
  }

  const total = items.reduce((sum, item) => {
    const product = productMap.get(item.productId)!
    return sum + product.price * item.quantity
  }, 0)

  const order = await getPrisma().order.create({
    data: {
      userId: user.id,
      storeId,
      total,
      status: "PENDING",
    },
  })

  await getPrisma().orderItem.createMany({
    data: items.map((item) => ({
      orderId: order.id,
      productId: item.productId,
      quantity: item.quantity,
      price: productMap.get(item.productId)!.price,
    })),
  })

  const store = await getPrisma().store.findUnique({ where: { id: storeId } })
  let applicationFeeAmount = 0
  if (store?.stripeConnectAccountId && store?.connectOnboardingComplete) {
    applicationFeeAmount = Math.round(total * 0.02) + 50
  }

  let session
  try {
    const origin = c.req.header("Origin") || "http://localhost:5173"
    const sessionParams: any = {
      mode: "payment",
      line_items: items.map((item) => {
        const product = productMap.get(item.productId)!
        return {
          price_data: {
            currency: "brl",
            product_data: { name: product.name },
            unit_amount: product.price,
          },
          quantity: item.quantity,
        }
      }),
      customer_email: email,
      metadata: { orderId: order.id },
      shipping_address_collection: { allowed_countries: ["BR"] },
      phone_number_collection: { enabled: true },
      success_url: `${origin}/account/orders?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout`,
    }
    if (applicationFeeAmount > 0) {
      sessionParams.payment_intent_data = {
        application_fee_amount: applicationFeeAmount,
        transfer_data: { destination: store!.stripeConnectAccountId! },
      }
    }
    session = await getStripe().checkout.sessions.create(sessionParams)
  } catch {
    await getPrisma().order.delete({ where: { id: order.id } }).catch(() => {})
    return c.json({ error: "Erro ao processar pagamento" }, 500)
  }

  await getPrisma().order.update({
    where: { id: order.id },
    data: { stripeCheckoutSessionId: session.id },
  })

  if (tokenUser) {
    await getPrisma().cartItem.deleteMany({ where: { userId: user.id } })
  }

  return c.json({ url: session.url })
})

export default checkoutSession
