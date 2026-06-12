import { Hono } from "hono"
import { prisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware } from "../lib/auth-middleware.js"

const products = new Hono()

products.get("/", async (c) => {
  const query = c.req.query()
  const category = query.category
  const search = query.search
  const slug = query.slug
  const limit = Math.min(Number(query.limit) || 20, 100)
  const offset = Number(query.offset) || 0

  const where: any = {}
  if (category) where.category = category
  if (slug) where.slug = slug
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ]
  }

  const [productList, count] = await Promise.all([
    prisma.product.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: "desc" } }),
    prisma.product.count({ where }),
  ])

  return c.json({ products: productList, count })
})

products.get("/:id", async (c) => {
  const id = c.req.param("id")
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return c.json({ error: "Not found" }, 404)
  return c.json(product)
})

products.post("/", authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json()
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  const product = await prisma.product.create({
    data: {
      name: body.name,
      slug,
      description: body.description || "",
      price: Math.round(body.price * 100),
      images: body.images || [],
      category: body.category || null,
      inventory: body.inventory ?? 0,
    },
  })

  return c.json(product, 201)
})

products.put("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json()

  const product = await prisma.product.update({
    where: { id },
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
  const id = c.req.param("id")
  await prisma.product.delete({ where: { id } })
  return c.json({ success: true })
})

export default products
