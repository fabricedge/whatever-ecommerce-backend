import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware } from "../lib/auth-middleware.js"

const products = new Hono()

function getStoreId(c: any): string {
  return c.get("storeId")!
}

products.get("/categories", async (c) => {
  const storeId = getStoreId(c)
  const result = await getPrisma().product.findMany({
    where: { category: { not: null }, storeId },
    select: { category: true },
    distinct: ["category"],
  })
  const categories = result.map((r) => r.category).filter(Boolean) as string[]

  const counts = await Promise.all(
    categories.map((cat) =>
      getPrisma().product.count({ where: { category: cat, storeId } })
    )
  )

  return c.json({
    categories: categories.map((name, i) => ({ name, productCount: counts[i] })),
  })
})

products.get("/", async (c) => {
  const storeId = getStoreId(c)
  const query = c.req.query()
  const category = query.category
  const search = query.search
  const slug = query.slug
  const limit = Math.min(Number(query.limit) || 20, 100)
  const offset = Number(query.offset) || 0

  if (slug) {
    const product = await getPrisma().product.findUnique({ where: { slug, storeId } })
    return c.json({ products: product ? [product] : [], count: product ? 1 : 0 })
  }

  const where: any = { storeId }
  if (category) where.category = category
  if (query.ids) {
    const ids = query.ids.split(",").filter(Boolean)
    if (ids.length > 0) where.id = { in: ids }
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ]
  }

  const [productList, count] = await Promise.all([
    getPrisma().product.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: "desc" } }),
    getPrisma().product.count({ where }),
  ])

  return c.json({ products: productList, count })
})

products.get("/:id", async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")
  const product = await getPrisma().product.findUnique({ where: { id, storeId } })
  if (!product) return c.json({ error: "Not found" }, 404)
  return c.json(product)
})

products.post("/", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  const product = await getPrisma().product.create({
    data: {
      name: body.name,
      slug,
      description: body.description || "",
      price: Math.round(body.price * 100),
      images: body.images || [],
      category: body.category || null,
      inventory: body.inventory ?? 0,
      storeId,
    },
  })

  return c.json(product, 201)
})

products.put("/:id", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")
  const body = await c.req.json()

  const product = await getPrisma().product.update({
    where: { id, storeId },
    data: {
      name: body.name,
      description: body.description,
      price: body.price ? Math.round(body.price * 100) : undefined,
      images: body.images,
      category: body.category,
      inventory: body.inventory,
    },
  })

  return c.json(product)
})

products.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")
  await getPrisma().product.delete({ where: { id, storeId } })
  return c.json({ success: true })
})

products.delete("/category/:name", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const name = decodeURIComponent(c.req.param("name")!)
  await getPrisma().product.updateMany({
    where: { category: name, storeId },
    data: { category: null },
  })
  return c.json({ success: true })
})

export default products
