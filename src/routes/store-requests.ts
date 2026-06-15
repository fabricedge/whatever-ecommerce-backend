import { Hono } from "hono"
import { hashSync, compare } from "bcryptjs"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"
import { deployStorefront } from "../services/vercel.js"
import { createCnameRecord, deleteDnsRecord } from "../services/cloudflare.js"

const storeRequests = new Hono()

// Admin: submit a new store request
storeRequests.post("/", authMiddleware, adminMiddleware, async (c) => {
  const user = getUser(c)
  const body = await c.req.json()
  const storeName: string = body.storeName?.trim()
  if (!storeName) return c.json({ error: "storeName is required" }, 400)

  const pending = await getPrisma().storeRequest.count({
    where: { adminId: user.userId, status: "PENDING" },
  })
  if (pending >= 3) {
    return c.json({ error: "You already have 3 pending requests. Wait for approval before submitting more." }, 429)
  }

  const req = await getPrisma().storeRequest.create({
    data: {
      storeName,
      adminNotes: body.adminNotes?.trim() || null,
      storefrontType: body.storefrontType === "INDEPENDENT" ? "INDEPENDENT" : "DEFAULT",
      enableToken: body.enableToken === true,
      customizationData: body.customizationData || undefined,
      adminId: user.userId,
    },
  })

  return c.json(req, 201)
})

// Super admin: list all requests with admin info
storeRequests.get("/", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const status = c.req.query("status")
  const where: any = {}
  if (status && ["PENDING", "APPROVED", "REJECTED"].includes(status)) {
    where.status = status
  }

  const list = await getPrisma().storeRequest.findMany({
    where,
    include: {
      admin: { select: { id: true, email: true, name: true } },
      store: {
        select: {
          id: true, name: true, slug: true, domain: true,
          storefrontType: true, deploymentUrl: true, deploymentStatus: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return c.json({ requests: list })
})

// Admin: list own requests
storeRequests.get("/mine", authMiddleware, async (c) => {
  const user = getUser(c)

  const list = await getPrisma().storeRequest.findMany({
    where: { adminId: user.userId },
    include: {
      store: {
        select: {
          id: true, name: true, slug: true, domain: true, isActive: true,
          storefrontType: true, deploymentUrl: true, deploymentStatus: true,
          deploymentToken: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return c.json({ requests: list })
})

// Super admin: approve a request (creates store + UserStore)
// If storefrontType is INDEPENDENT, also generates deployment URL and token
storeRequests.put("/:id/approve", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const storeRequest = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!storeRequest) return c.json({ error: "Request not found" }, 404)
  if (storeRequest.status !== "PENDING") return c.json({ error: "Request is already processed" }, 400)

  const slug = storeRequest.storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "loja"

  const cd = (storeRequest.customizationData as Record<string, any>) || {}

  let dnsRecordId: string | null = null
  const customDomain = cd.domain?.trim()
  const subdomainDomain = `${slug}.fskk.site`
  const finalDomain = customDomain || subdomainDomain

  // Create CNAME record via Cloudflare API
  if (storeRequest.storefrontType === "INDEPENDENT") {
    try {
      const dns = await createCnameRecord(slug, "stfront.fskk.site")
      dnsRecordId = dns.id
    } catch (err: any) {
      return c.json({ error: `Failed to create DNS record: ${err.message}` }, 500)
    }
  }

  try {
    const store = await getPrisma().store.create({
      data: {
        name: storeRequest.storeName,
        slug,
        storefrontType: storeRequest.storefrontType,
        domain: finalDomain,
      },
    })

    // Apply branding from customizationData
    if (cd.primaryColor || cd.secondaryColor || cd.logoUrl || cd.faviconUrl || cd.fontFamily) {
      const brandingKeys: Record<string, string> = {
        primary_color: cd.primaryColor,
        secondary_color: cd.secondaryColor,
        logo_url: cd.logoUrl,
        favicon_url: cd.faviconUrl,
        font_family: cd.fontFamily,
      }
      await Promise.all(
        Object.entries(brandingKeys)
          .filter(([, v]) => v)
          .map(([k, v]) =>
            getPrisma().setting.upsert({
              where: { storeId_key: { storeId: store.id, key: `branding_${k}` } },
              create: { storeId: store.id, key: `branding_${k}`, value: String(v) },
              update: { value: String(v) },
            })
          )
      )
    }

    let rawToken: string | undefined
    if (storeRequest.storefrontType === "INDEPENDENT") {
      const result = await deployStorefront(store.id, slug, storeRequest.enableToken)
      rawToken = result.rawToken
      const tokenHash = rawToken ? hashSync(rawToken, 10) : null
      await getPrisma().store.update({
        where: { id: store.id },
        data: {
          deploymentUrl: result.url,
          deploymentToken: tokenHash,
          deploymentStatus: "READY",
        },
      })
    }

    await getPrisma().userStore.create({
      data: { userId: storeRequest.adminId, storeId: store.id },
    })

    const updated = await getPrisma().storeRequest.update({
      where: { id },
      data: { status: "APPROVED", storeId: store.id },
      include: {
        store: {
          select: {
            id: true, name: true, slug: true, domain: true,
            storefrontType: true, deploymentUrl: true, deploymentStatus: true,
          },
        },
      },
    })

    return c.json({ ...updated, rawToken })
  } catch (err: any) {
    // Rollback: delete DNS record if it was created
    if (dnsRecordId) {
      try { await deleteDnsRecord(dnsRecordId) } catch {}
    }
    return c.json({ error: `Approval failed: ${err.message}` }, 500)
  }

  return c.json({ error: "Unexpected end of approval" }, 500)
})

// Super admin: reject a request
storeRequests.put("/:id/reject", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const body = await c.req.json()

  const req = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!req) return c.json({ error: "Request not found" }, 404)
  if (req.status !== "PENDING") return c.json({ error: "Request is already processed" }, 400)

  const updated = await getPrisma().storeRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectReason: body.rejectReason?.trim() || null,
    },
  })

  return c.json(updated)
})

// Verify deployment token for independent storefronts
storeRequests.post("/verify-token", async (c) => {
  const body = await c.req.json()
  const storeId: string = body.storeId?.trim()
  const code: string = body.code?.trim()

  if (!storeId || !code) return c.json({ valid: false, error: "storeId and code are required" }, 400)

  const store = await getPrisma().store.findUnique({ where: { id: storeId } })
  if (!store) return c.json({ valid: false, error: "Store not found" }, 404)
  if (!store.deploymentToken) return c.json({ valid: false, error: "No token configured for this store" }, 400)

  const valid = await compare(code, store.deploymentToken)
  return c.json({ valid })
})

export default storeRequests
