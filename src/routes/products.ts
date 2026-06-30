import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware } from "../lib/auth-middleware.js"

const products = new Hono()

function getStoreId(c: any): string {
  return c.get("storeId")!
}

function includeCategory() {
  return { categoryRel: { select: { id: true, name: true } } }
}

products.get("/", async (c) => {
  const storeId = getStoreId(c)
  const query = c.req.query()
  const category = query.category
  const search = query.search
  const slug = query.slug
  const limit = Math.min(Number(query.limit) || 20, 100)
  const offset = Number(query.offset) || 0

  if (slug) {
    const product = await getPrisma().product.findUnique({
      where: { slug, storeId },
      include: includeCategory(),
    })
    return c.json({ products: product ? [product] : [], count: product ? 1 : 0 })
  }

  const where: any = { storeId }
  if (category) where.categoryRel = { name: category }
  if (query.ids) {
    const ids = query.ids.split(",").filter(Boolean)
    if (ids.length > 0) where.id = { in: ids }
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { categoryRel: { name: { contains: search, mode: "insensitive" } } },
      { sku: { contains: search, mode: "insensitive" } },
    ]
  }

  const [productList, count] = await Promise.all([
    getPrisma().product.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: includeCategory(),
    }),
    getPrisma().product.count({ where }),
  ])

  return c.json({ products: productList, count })
})

products.get("/export", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const all = await getPrisma().product.findMany({
    where: { storeId },
    include: includeCategory(),
    orderBy: { createdAt: "desc" },
  })
  return c.json({ products: all })
})

products.get("/:id", async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")
  const product = await getPrisma().product.findUnique({
    where: { id, storeId },
    include: includeCategory(),
  })
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
      sku: body.sku || null,
      description: body.description || "",
      price: Math.round(body.price * 100),
      images: body.images || [],
      categoryId: body.categoryId || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      inventory: body.inventory ?? 0,
      weight: body.weight != null ? parseFloat(body.weight) : null,
      length: body.length != null ? parseFloat(body.length) : null,
      width: body.width != null ? parseFloat(body.width) : null,
      height: body.height != null ? parseFloat(body.height) : null,
      storeId,
    },
    include: includeCategory(),
  })

  return c.json(product, 201)
})

products.post("/import", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const { products: rows } = await c.req.json()

  if (!Array.isArray(rows) || rows.length === 0) {
    return c.json({ error: "No products provided" }, 400)
  }

  const created: number[] = []
  const errors: { row: number; message: string }[] = []
  const existingSlugs = new Set<string>()

  const existing = await getPrisma().product.findMany({
    where: { storeId },
    select: { slug: true },
  })
  for (const p of existing) existingSlugs.add(p.slug)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]

    if (!row.name || typeof row.name !== "string" || !row.name.trim()) {
      errors.push({ row: i, message: "Nome do produto é obrigatório" })
      continue
    }

    let slug = row.slug || row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    let suffix = 2
    const originalSlug = slug
    while (existingSlugs.has(slug)) {
      slug = `${originalSlug}-${suffix}`
      suffix++
    }
    existingSlugs.add(slug)

    const price = typeof row.price === "number" ? Math.round(row.price) : 0

    let categoryId = row.categoryId || null
    if (!categoryId && row.category) {
      const catName = String(row.category).trim()
      if (catName) {
        let cat = await getPrisma().category.findUnique({
          where: { name_storeId: { name: catName, storeId } },
        })
        if (!cat) {
          cat = await getPrisma().category.create({
            data: { name: catName, storeId },
          })
        }
        categoryId = cat.id
      }
    }

    try {
      await getPrisma().product.create({
        data: {
          name: row.name.trim(),
          slug,
          sku: row.sku || null,
          description: row.description || "",
          price,
          images: Array.isArray(row.images) ? row.images : [],
          categoryId,
          tags: Array.isArray(row.tags) ? row.tags : [],
          inventory: typeof row.inventory === "number" ? row.inventory : 0,
          weight: row.weight != null ? parseFloat(row.weight) : null,
          length: row.length != null ? parseFloat(row.length) : null,
          width: row.width != null ? parseFloat(row.width) : null,
          height: row.height != null ? parseFloat(row.height) : null,
          storeId,
        },
      })
      created.push(i)
    } catch (err: any) {
      errors.push({ row: i, message: err.message || "Erro ao criar produto" })
    }
  }

  return c.json({ created: created.length, errors })
})

products.put("/:id", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")
  const body = await c.req.json()

  const product = await getPrisma().product.update({
    where: { id, storeId },
    data: {
      name: body.name,
      sku: body.sku,
      description: body.description,
      price: body.price ? Math.round(body.price * 100) : undefined,
      images: body.images,
      categoryId: body.categoryId !== undefined ? body.categoryId : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      inventory: body.inventory,
      weight: body.weight != null ? parseFloat(body.weight) : undefined,
      length: body.length != null ? parseFloat(body.length) : undefined,
      width: body.width != null ? parseFloat(body.width) : undefined,
      height: body.height != null ? parseFloat(body.height) : undefined,
    },
    include: includeCategory(),
  })

  return c.json(product)
})

products.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")
  await getPrisma().product.delete({ where: { id, storeId } })
  return c.json({ success: true })
})

export default products
