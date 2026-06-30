import { Hono } from "hono"
import { Context } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { getStripe } from "../lib/stripe.js"
import { verifyToken } from "../lib/jwt.js"
import { isConfigured } from "../lib/easyship.js"

const checkoutSession = new Hono()

function getStoreId(c: Context): string {
  return c.get("storeId")!
}

async function getOriginCountry(storeId: string): Promise<string> {
  const setting = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId, key: "origin_country" } },
  })
  return setting?.value || "US"
}

checkoutSession.post("/", async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()

  let email: string | undefined
  let items: { productId: string; quantity: number }[] | undefined

  const shippingInfo = {
    shippingZip: body.shippingZip || "",
    shippingAmount: body.shippingAmount ? Math.round(body.shippingAmount) : 0,
    courierServiceId: body.courierServiceId || "",
    carrier: body.carrier || "",
    serviceLevel: body.serviceLevel || "",
    shippingCountry: body.shippingCountry || "",
    shippingName: body.shippingName || "",
    shippingAddress: body.shippingAddress || "",
    shippingCity: body.shippingCity || "",
    shippingState: body.shippingState || "",
    shippingPhone: body.shippingPhone || "",
  }

  if (shippingInfo.courierServiceId || shippingInfo.shippingZip) {
    const configured = await isConfigured(storeId)
    const originCountry = await getOriginCountry(storeId)
    if (configured && shippingInfo.shippingCountry.toUpperCase() !== originCountry.toUpperCase()) {
      return c.json({ error: `EasyShip só suporta entregas domésticas em ${originCountry} por enquanto` }, 400)
    }
  }

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

  const orderTotal = total + shippingInfo.shippingAmount

  const order = await getPrisma().order.create({
    data: {
      userId: user.id,
      storeId,
      total: orderTotal,
      status: "PENDING",
      shippingZip: shippingInfo.shippingZip || null,
      shippingPrice: shippingInfo.shippingAmount || null,
      carrier: shippingInfo.carrier || null,
      serviceLevel: shippingInfo.serviceLevel || null,
      shippingCountry: shippingInfo.shippingCountry || null,
      shippingName: shippingInfo.shippingName || null,
      shippingAddress: shippingInfo.shippingAddress || null,
      shippingCity: shippingInfo.shippingCity || null,
      shippingState: shippingInfo.shippingState || null,
      shippingPhone: shippingInfo.shippingPhone || null,
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

  let session
  try {
    const origin = c.req.header("Origin") || "http://localhost:5173"
    const lineItems: any[] = items.map((item) => {
      const product = productMap.get(item.productId)!
      return {
        price_data: {
          currency: "brl",
          product_data: { name: product.name },
          unit_amount: product.price,
        },
        quantity: item.quantity,
      }
    })

    if (shippingInfo.shippingAmount > 0) {
      lineItems.push({
        price_data: {
          currency: "brl",
          product_data: { name: `Frete (${shippingInfo.carrier}${shippingInfo.serviceLevel ? ` - ${shippingInfo.serviceLevel}` : ""})` },
          unit_amount: shippingInfo.shippingAmount,
        },
        quantity: 1,
      })
    }

    const sessionParams: any = {
      mode: "payment",
      line_items: lineItems,
      customer_email: email,
      metadata: {
        orderId: order.id,
        ...(shippingInfo.courierServiceId ? { courierServiceId: shippingInfo.courierServiceId } : {}),
      },
      shipping_address_collection: { allowed_countries: ["BR", "US", "DE", "FR", "GB", "PT", "ES", "IT", "AR", "CL", "CO", "MX", "PY", "UY"] },
      phone_number_collection: { enabled: true },
      success_url: `${origin}/account/orders?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout`,
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
