import { Hono } from "hono"
import { Context } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"
import { getRates, createShipment, trackShipment, isDHLConfigured } from "../lib/dhl.js"

const shipping = new Hono()

function getStoreId(c: Context): string {
  return c.get("storeId")!
}

shipping.get("/status", authMiddleware, adminMiddleware, (c) => {
  return c.json({ configured: isDHLConfigured() })
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

  const store = await getPrisma().store.findUnique({ where: { id: storeId } })

  const setting = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId, key: "dhl_origin_zip" } },
  })

  const originZip = setting?.value || "01001000"
  const weight = body.weight || order.shippingWeight || 0.5
  const length = body.length || order.shippingLength || 20
  const width = body.width || order.shippingWidth || 15
  const height = body.height || order.shippingHeight || 10
  const declaredValue = order.total
  const declaredCurrency = "BRL"

  const result = await getRates({
    originCountryCode: "BR",
    originPostalCode: originZip,
    destinationCountryCode: "BR",
    destinationPostalCode: order.shippingZip,
    weight,
    length,
    width,
    height,
    declaredValue,
    declaredCurrency,
  })

  if (result.error) return c.json({ error: result.error }, 502)

  return c.json(result)
})

shipping.post("/label", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()
  const { orderId, productCode, weight, length, width, height } = body

  if (!orderId || !productCode) {
    return c.json({ error: "orderId e productCode são obrigatórios" }, 400)
  }

  const order = await getPrisma().order.findUnique({
    where: { id: orderId, storeId },
    include: { items: { include: { product: true } }, user: true },
  })

  if (!order) return c.json({ error: "Pedido não encontrado" }, 404)

  const setting = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId, key: "dhl_origin_zip" } },
  })

  const originZip = setting?.value || "01001000"
  const settingCity = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId, key: "dhl_origin_city" } },
  })
  const settingAddress = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId, key: "dhl_origin_address" } },
  })

  const user = getUser(c)
  const result = await createShipment({
    shipper: {
      postalCode: originZip,
      city: settingCity?.value || "São Paulo",
      countryCode: "BR",
      addressLine1: settingAddress?.value || "Rua Exemplo, 100",
      name: "Loja",
      phone: "11999999999",
      email: user.email || "loja@exemplo.com",
    },
    receiver: {
      postalCode: order.shippingZip || "",
      city: order.shippingCity || "",
      countryCode: "BR",
      addressLine1: order.shippingAddress || "",
      name: order.shippingName || order.user?.name || "",
      phone: order.shippingPhone || "",
      email: order.user?.email || "",
    },
    packages: [{
      weight: weight || order.shippingWeight || 0.5,
      length: length || order.shippingLength || 20,
      width: width || order.shippingWidth || 15,
      height: height || order.shippingHeight || 10,
    }],
    productCode,
    declaredValue: order.total,
    declaredCurrency: "BRL",
    content: order.items.map(i => i.product?.name || `Item #${i.productId}`).join(", "),
    unitOfMeasurement: 'metric',
    orderReference: orderId.slice(0, 30),
  })

  if (result.error) return c.json({ error: result.error }, 502)

  await getPrisma().order.update({
    where: { id: orderId },
    data: {
      trackingCode: result.shipmentTrackingNumber,
      shippingLabelB64: result.labelB64,
      shippingProduct: productCode,
      shippingPrice: result.shipmentTrackingNumber ? 0 : undefined,
      shippingWeight: weight || undefined,
      shippingLength: length || undefined,
      shippingWidth: width || undefined,
      shippingHeight: height || undefined,
    },
  })

  return c.json(result)
})

shipping.get("/tracking/:code", authMiddleware, adminMiddleware, async (c) => {
  const code = c.req.param("code")!
  if (!code) return c.json({ error: "Código de rastreio é obrigatório" }, 400)

  const result = await trackShipment(code)
  if (result.error) return c.json({ error: result.error }, 502)

  return c.json(result)
})

export default shipping
