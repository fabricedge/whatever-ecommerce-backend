import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, getUser } from "../lib/auth-middleware.js"

const auditLogs = new Hono()

auditLogs.get("/", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const query = c.req.query()
  const page = Math.max(Number(query.page) || 1, 1)
  const limit = Math.min(Number(query.limit) || 50, 100)
  const actionFilter = query.action
  const entityFilter = query.entityType

  const where: any = {}
  if (actionFilter) where.action = actionFilter
  if (entityFilter) where.entityType = entityFilter

  const [logs, count] = await Promise.all([
    getPrisma().auditLog.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    getPrisma().auditLog.count({ where }),
  ])

  const actions = await getPrisma().auditLog.groupBy({
    by: ["action"],
    _count: true,
    orderBy: { _count: { action: "desc" } },
  })

  return c.json({
    logs,
    count,
    pages: Math.ceil(count / limit),
    actions: actions.map((a) => a.action),
  })
})

export default auditLogs
