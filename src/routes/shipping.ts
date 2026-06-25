import { Hono } from "hono"
import { Context } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware } from "../lib/auth-middleware.js"
import {
  getRates,
  createLabel,
  trackShipment,
  isConfigured,
  hasOwnCredentials,
} from "../lib/easyship.js"

const shipping = new Hono()

function getStoreId(c: Context): string {
  return c.get("storeId")!
}

async function getOriginSettings(storeId: string) {
  const settings = await getPrisma().setting.findMany({
    where: { storeId, key: { startsWith: "origin_" } },
  })
  const map: Record<string, string> = {}
  for (const s of settings) map[s.key] = s.value
  return {
    name: map.origin_name || "Loja",
    company: map.origin_company || "",
    phone: map.origin_phone || "11999999999",
    email: map.origin_email || "loja@exemplo.com",
    street1: map.origin_street || "Rua Exemplo, 100",
    city: map.origin_city || "São Paulo",
    state: map.origin_state || "SP",
    zip: map.origin_zip || "01001000",
    country: map.origin_country || "BR",
  }
}

shipping.get("/status", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const [configured, ownCreds] = await Promise.all([
    isConfigured(storeId),
    hasOwnCredentials(storeId),
  ])
  return c.json({ configured, usingOwnAccount: ownCreds })
})

shipping.post("/rates", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()
  const { orderId } = body

  if (!orderId) return c.json({ error: "orderId é obrigatório" }, 400)

  const order = await getPrisma().order.findUnique({
    where: { id: orderId, storeId },
  })

  if (!order) return c.json({ error: "Pedido não encontrado" }, 404)
  if (!order.shippingZip) return c.json({ error: "Pedido não tem CEP de destino" }, 400)

  const origin = await getOriginSettings(storeId)

  const weight = body.weight || order.shippingWeight || 0.5
  const length = body.length || order.shippingLength || 20
  const width = body.width || order.shippingWidth || 15
  const height = body.height || order.shippingHeight || 10

  const result = await getRates(
    {
      name: origin.name,
      company: origin.company,
      street1: origin.street1,
      city: origin.city,
      state: origin.state,
      zip: origin.zip,
      country: origin.country,
      phone: origin.phone,
      email: origin.email,
    },
    {
      name: order.shippingName || "Cliente",
      street1: order.shippingAddress || "",
      city: order.shippingCity || "",
      state: order.shippingState || "",
      zip: order.shippingZip || "",
      country: order.shippingCountry || "BR",
      phone: order.shippingPhone || "",
    },
    {
      length,
      width,
      height,
      distanceUnit: "cm",
      weight,
      massUnit: "kg",
    },
    storeId,
  )

  if (result.error) return c.json({ error: result.error }, 502)

  return c.json({ products: result.rates })
})

shipping.post("/label", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()
  const { orderId, courierServiceId } = body

  if (!orderId || !courierServiceId) {
    return c.json({ error: "orderId e courierServiceId são obrigatórios" }, 400)
  }

  const order = await getPrisma().order.findUnique({
    where: { id: orderId, storeId },
    include: { items: { include: { product: true } }, user: true },
  })

  if (!order) return c.json({ error: "Pedido não encontrado" }, 404)

  const origin = await getOriginSettings(storeId)

  const weight = order.shippingWeight || 0.5
  const length = order.shippingLength || 20
  const width = order.shippingWidth || 15
  const height = order.shippingHeight || 10

  const items = (order.items || []).map((item) => ({
    description: item.product?.name || item.productId,
    quantity: item.quantity,
    price: item.price,
    currency: "BRL",
  }))

  const result = await createLabel(
    {
      name: origin.name,
      company: origin.company,
      street1: origin.street1,
      city: origin.city,
      state: origin.state,
      zip: origin.zip,
      country: origin.country,
      phone: origin.phone,
      email: origin.email,
    },
    {
      name: order.shippingName || "Cliente",
      street1: order.shippingAddress || "",
      city: order.shippingCity || "",
      state: order.shippingState || "",
      zip: order.shippingZip || "",
      country: order.shippingCountry || "BR",
      phone: order.shippingPhone || "",
    },
    { length, width, height, distanceUnit: "cm", weight, massUnit: "kg" },
    courierServiceId,
    items,
    storeId,
  )

  if (result.error) return c.json({ error: result.error }, 502)

  await getPrisma().order.update({
    where: { id: orderId },
    data: {
      trackingCode: result.trackingNumber,
      shippingLabelUrl: result.labelUrl,
      carrier: result.carrier,
      serviceLevel: result.serviceLevel,
      easyshipShipmentId: result.easyshipShipmentId,
      shippingPrice: result.trackingNumber ? 0 : undefined,
    },
  })

  return c.json(result)
})

shipping.get(
  "/tracking/:shipmentId",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const storeId = getStoreId(c)
    const shipmentId = c.req.param("shipmentId")!
    if (!shipmentId)
      return c.json({ error: "shipmentId é obrigatório" }, 400)

    const result = await trackShipment(shipmentId, storeId)
    if (result.error) return c.json({ error: result.error }, 502)

    return c.json(result)
  },
)

export default shipping
