import { Hono } from "hono"
import { Context } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { getStripe } from "../lib/stripe.js"
import { verifyToken } from "../lib/jwt.js"

const checkout = new Hono()

function getStoreId(c: Context): string {
  return c.get("storeId")!
}

checkout.post("/", async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()

  let email: string | undefined
  let items: { productId: string; quantity: number }[] | undefined

  // check if authenticated
  const authHeader = c.req.header("Authorization")
  let tokenUser: { userId: string; role: string; email: string } | null = null
  if (authHeader?.startsWith("Bearer ")) {
    try {
      tokenUser = await verifyToken(authHeader.slice(7)) as any
    } catch {}
  }

  if (tokenUser) {
    // authenticated flow — read cart from DB
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
    // anonymous flow — receive items in body
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

  // find or create user by email
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

  let paymentIntent
  try {
    paymentIntent = await getStripe().paymentIntents.create({
      amount: total,
      currency: "brl",
      metadata: { orderId: order.id },
      automatic_payment_methods: { enabled: true },
    })
  } catch {
    await getPrisma().order.delete({ where: { id: order.id } }).catch(() => {})
    return c.json({ error: "Erro ao processar pagamento" }, 500)
  }

  await getPrisma().order.update({
    where: { id: order.id },
    data: { stripePaymentIntentId: paymentIntent.id },
  })

  // clear cart only for logged-in users
  if (tokenUser) {
    await getPrisma().cartItem.deleteMany({ where: { userId: user.id } })
  }

  return c.json({ clientSecret: paymentIntent.client_secret, orderId: order.id })
})

export default checkout
