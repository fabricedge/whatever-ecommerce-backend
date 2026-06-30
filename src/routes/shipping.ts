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
  checkConnection,
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
    country: map.origin_country || "US",
  }
}

async function getShippingDefaults(storeId: string) {
  const settings = await getPrisma().setting.findMany({
    where: { storeId, key: { startsWith: "default_" } },
  })
  const map: Record<string, string> = {}
  for (const s of settings) map[s.key] = s.value
  return {
    weight: parseFloat(map.default_weight || "0.5"),
    length: parseInt(map.default_length || "20", 10),
    width: parseInt(map.default_width || "15", 10),
    height: parseInt(map.default_height || "10", 10),
  }
}

shipping.post("/calculate", async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()
  const { zip, items, country, state } = body

  if (!zip) return c.json({ error: "CEP é obrigatório" }, 400)
  if (!items || !Array.isArray(items) || items.length === 0) {
    return c.json({ error: "Carrinho vazio" }, 400)
  }

  const configured = await isConfigured(storeId)
  if (!configured) return c.json({ error: "Frete não configurado" }, 400)

  const origin = await getOriginSettings(storeId)

  const destCountry = (country || origin.country).toUpperCase()
  if (destCountry !== origin.country.toUpperCase()) {
    return c.json({ error: `EasyShip só suporta entregas domésticas em ${origin.country} por enquanto` }, 400)
  }
  const defaults = await getShippingDefaults(storeId)

  const productIds = items.map((i: any) => i.productId)
  const products = await getPrisma().product.findMany({
    where: { id: { in: productIds } },
  })
  const productMap = new Map(products.map((p) => [p.id, p]))

  let totalWeight = 0
  let maxLength = defaults.length
  let maxWidth = defaults.width
  let maxHeight = defaults.height

  const rateItems = items.map((item: any) => {
    const product = productMap.get(item.productId)
    const pw = product?.weight ?? defaults.weight
    const pl = product?.length ?? defaults.length
    const pw2 = product?.width ?? defaults.width
    const ph = product?.height ?? defaults.height
    totalWeight += pw * item.quantity
    if (pl > maxLength) maxLength = pl
    if (pw2 > maxWidth) maxWidth = pw2
    if (ph > maxHeight) maxHeight = ph
    return {
      actualWeight: pw,
      hsCode: '847130',
      declaredCurrency: "BRL",
      declaredCustomsValue: product ? Math.round(product.price / 100) : 5000,
    }
  })

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
      name: "Cliente",
      street1: "",
      city: "Destino",
      state: state || "",
      zip,
      country: country || origin.country,
    },
    {
      length: maxLength,
      width: maxWidth,
      height: maxHeight,
      distanceUnit: "cm",
      weight: Math.max(totalWeight, 0.1),
      massUnit: "kg",
    },
    storeId,
    rateItems,
  )

  if (result.error) return c.json({ error: result.error }, 502)

  return c.json({ products: result.rates })
})

shipping.get("/status", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const [configured, ownCreds] = await Promise.all([
    isConfigured(storeId),
    hasOwnCredentials(storeId),
  ])
  return c.json({ configured, usingOwnAccount: ownCreds })
})

shipping.post("/check", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const result = await checkConnection(storeId)

  await getPrisma().setting.upsert({
    where: { storeId_key: { storeId, key: 'easyship_status' } },
    create: { storeId, key: 'easyship_status', value: result.status },
    update: { value: result.status },
  })
  await getPrisma().setting.upsert({
    where: { storeId_key: { storeId, key: 'easyship_status_msg' } },
    create: { storeId, key: 'easyship_status_msg', value: result.message },
    update: { value: result.message },
  })
  await getPrisma().setting.upsert({
    where: { storeId_key: { storeId, key: 'easyship_status_at' } },
    create: { storeId, key: 'easyship_status_at', value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  })

  return c.json(result)
})

shipping.post("/rates", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()
  const { orderId } = body

  if (!orderId) return c.json({ error: "orderId é obrigatório" }, 400)

  const order = await getPrisma().order.findUnique({
    where: { id: orderId, storeId },
    include: { items: { include: { product: true } } },
  })

  if (!order) return c.json({ error: "Pedido não encontrado" }, 404)
  if (!order.shippingZip) return c.json({ error: "Pedido não tem CEP de destino" }, 400)

  const origin = await getOriginSettings(storeId)
  const defaults = await getShippingDefaults(storeId)

  let totalWeight = 0
  let maxLength = defaults.length
  let maxWidth = defaults.width
  let maxHeight = defaults.height

  const rateItems = (order.items || []).map((item) => {
    const p = item.product
    const pw = p?.weight ?? defaults.weight
    const pl = p?.length ?? defaults.length
    const pw2 = p?.width ?? defaults.width
    const ph = p?.height ?? defaults.height
    totalWeight += pw * item.quantity
    if (pl > maxLength) maxLength = pl
    if (pw2 > maxWidth) maxWidth = pw2
    if (ph > maxHeight) maxHeight = ph
    return {
      actualWeight: pw,
      hsCode: '847130',
      declaredCurrency: 'BRL',
      declaredCustomsValue: Math.round((item.price) / 100),
    }
  })

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
      country: order.shippingCountry || origin.country,
      phone: order.shippingPhone || "",
    },
    {
      length: maxLength,
      width: maxWidth,
      height: maxHeight,
      distanceUnit: "cm",
      weight: Math.max(totalWeight, 0.1),
      massUnit: "kg",
    },
    storeId,
    rateItems,
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

  const destCountry = (order.shippingCountry || origin.country).toUpperCase()
  if (destCountry !== origin.country.toUpperCase()) {
    return c.json({ error: `EasyShip só suporta entregas domésticas em ${origin.country} por enquanto` }, 400)
  }
  const defaults = await getShippingDefaults(storeId)

  let totalWeight = 0
  let maxLength = defaults.length
  let maxWidth = defaults.width
  let maxHeight = defaults.height

  const items = (order.items || []).map((item) => {
    const p = item.product
    const pw = p?.weight ?? defaults.weight
    const pl = p?.length ?? defaults.length
    const pw2 = p?.width ?? defaults.width
    const ph = p?.height ?? defaults.height
    totalWeight += pw * item.quantity
    if (pl > maxLength) maxLength = pl
    if (pw2 > maxWidth) maxWidth = pw2
    if (ph > maxHeight) maxHeight = ph
    return {
      description: p?.name || item.productId,
      quantity: item.quantity,
      price: item.price,
      currency: "BRL",
    }
  })

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
      country: order.shippingCountry || origin.country,
      phone: order.shippingPhone || "",
    },
    { length: maxLength, width: maxWidth, height: maxHeight, distanceUnit: "cm", weight: Math.max(totalWeight, 0.1), massUnit: "kg" },
    courierServiceId,
    storeId,
    items,
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
