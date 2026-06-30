import { Context } from "hono"
import { getPrisma } from "./prisma.js"
import { getUser } from "./auth-middleware.js"

export async function logAudit(
  c: Context,
  action: string,
  entityType: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  const user = getUser(c)
  if (!user?.userId) return

  await getPrisma().auditLog.create({
    data: {
      userId: user.userId,
      action,
      entityType,
      entityId,
      details: details as any,
    },
  })
}
