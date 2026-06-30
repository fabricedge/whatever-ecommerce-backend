import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware } from "../lib/auth-middleware.js"

const categories = new Hono()

function getStoreId(c: any): string {
  return c.get("storeId")!
}

categories.get("/", async (c) => {
  const storeId = getStoreId(c)
  const all = await getPrisma().category.findMany({
    where: { storeId },
    include: { _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  })
  return c.json({
    categories: all.map((cat) => ({
      id: cat.id,
      name: cat.name,
      productCount: cat._count.products,
      createdAt: cat.createdAt,
    })),
  })
})

categories.post("/", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const { name } = await c.req.json()
  if (!name || typeof name !== "string" || !name.trim()) {
    return c.json({ error: "Nome é obrigatório" }, 400)
  }
  const trimmed = name.trim()
  const existing = await getPrisma().category.findUnique({
    where: { name_storeId: { name: trimmed, storeId } },
  })
  if (existing) return c.json({ error: "Categoria já existe" }, 409)
  const cat = await getPrisma().category.create({
    data: { name: trimmed, storeId },
  })
  return c.json(cat, 201)
})

categories.put("/:id", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")
  const { name } = await c.req.json()
  if (!name || typeof name !== "string" || !name.trim()) {
    return c.json({ error: "Nome é obrigatório" }, 400)
  }
  const trimmed = name.trim()
  const existing = await getPrisma().category.findUnique({
    where: { name_storeId: { name: trimmed, storeId } },
  })
  if (existing && existing.id !== id) {
    return c.json({ error: "Categoria já existe" }, 409)
  }
  const cat = await getPrisma().category.update({
    where: { id, storeId },
    data: { name: trimmed },
  })
  return c.json(cat)
})

categories.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")
  await getPrisma().product.updateMany({
    where: { categoryId: id, storeId },
    data: { categoryId: null },
  })
  await getPrisma().category.delete({ where: { id, storeId } })
  return c.json({ success: true })
})

export default categories
