import { Context, Next } from "hono"
import { getPrisma } from "./prisma.js"

export async function storeMiddleware(c: Context, next: Next) {
  const path = c.req.path

  // Store management routes identify stores by URL param, not X-Store-Id header.
  // Skip middleware for these to avoid blocking store activation/deactivation.
  if (path.startsWith("/api/stores") || path.startsWith("/api/store-requests")) {
    return await next()
  }

  const storeId = c.req.header("X-Store-Id")
  const user: { userId: string; role: string; email: string } | undefined = c.get("user")

  let resolvedStoreId: string

  if (storeId) {
    const store = await getPrisma().store.findUnique({ where: { id: storeId } })
    if (!store || !store.isActive) {
      return c.json({ error: "Store not found or inactive" }, 404)
    }
    if (user && user.role !== "SUPER_ADMIN") {
      const membership = await getPrisma().userStore.findUnique({
        where: { userId_storeId: { userId: user.userId, storeId } },
      })
      if (!membership) {
        return c.json({ error: "You don't have access to this store" }, 403)
      }
    }
    resolvedStoreId = store.id
  } else {
    let defaultStore = await getPrisma().store.findFirst({
      where: { slug: "minha-loja", id: { not: "global" } },
    })
    if (!defaultStore) {
      defaultStore = await getPrisma().store.findFirst({
        where: { isActive: true, id: { not: "global" } },
        orderBy: { createdAt: "asc" },
      })
    }
    if (!defaultStore) {
      return c.json({ error: "No store found" }, 500)
    }
    resolvedStoreId = defaultStore.id
  }

  c.set("storeId", resolvedStoreId)
  await next()
}
