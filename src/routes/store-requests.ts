import { Hono } from "hono"
import { hashSync, compare } from "bcryptjs"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"
import { logAudit } from "../lib/audit-log.js"
import { deployStorefront } from "../services/vercel.js"
import { createDnsRecord, deleteDnsRecord } from "../services/cloudflare.js"
import { getStripe } from "../lib/stripe.js"
import { checkDeployment, buildStoreUrl } from "../lib/deployment.js"


const storeRequests = new Hono()

// ─── Shared: activate store after billing conditions met ───
async function tryActivateStore(requestId: string, force = false): Promise<{ activated: boolean; rawToken?: string; url?: string }> {
  const req = await getPrisma().storeRequest.findUnique({ where: { id: requestId } })
  if (!req) return { activated: false }
  if (req.status !== "APPROVED" && req.status !== "APPROVED_PENDING_PAYMENT") return { activated: false }

  const cd = (req.customizationData as Record<string, any>) || {}
  const hasCustomDomain = !!cd.domain?.trim()

  if (!force && hasCustomDomain) {
    if (!req.setupFeePaid) return { activated: false }
  }

  const slug = req.storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "loja"
  const customDomain = cd.domain?.trim()
  const finalDomain = customDomain || `${slug}.fskk.site`

  let dnsRecordId: string | null = null
  try {
    const dns = await createDnsRecord(slug)
    dnsRecordId = dns.id
  } catch (err: any) {
    console.error(`[tryActivateStore] DNS failed for ${requestId}:`, err.message)
  }

  try {
    const store = await getPrisma().store.create({
      data: {
        name: req.storeName,
        slug,
        storefrontType: "INDEPENDENT",
        domain: finalDomain,
      },
    })

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

    const result = await deployStorefront(store.id, slug, req.enableToken, customDomain || undefined)
    const tokenHash = result.rawToken ? hashSync(result.rawToken, 10) : null
    await getPrisma().store.update({
      where: { id: store.id },
      data: {
        deploymentUrl: result.url,
        deploymentToken: tokenHash,
        deploymentStatus: result.status,
      },
    })

    await getPrisma().userStore.create({
      data: { userId: req.adminId, storeId: store.id },
    })

    await getPrisma().storeRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", storeId: store.id },
    })

    // Try health check (non-blocking, with retries — Vercel can take 30s-2min)
    ;(async () => {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 20000))
        const status = await checkDeployment(buildStoreUrl(slug))
        if (status === 'READY') {
          await getPrisma().store.update({
            where: { id: store.id },
            data: { deploymentStatus: 'READY' },
          })
          return
        }
      }
      console.warn(`[tryActivateStore] health check timed out for ${slug} after 6 retries`)
    })()
    return { activated: true, rawToken: result.rawToken, url: result.url }
  } catch (err: any) {
    console.error(`[tryActivateStore] creation failed for ${requestId}:`, err.message)
    if (dnsRecordId) {
      try { await deleteDnsRecord(dnsRecordId) } catch {}
    }
    return { activated: false }
  }
}

// ─── Admin: submit a new store request ───
storeRequests.post("/", authMiddleware, adminMiddleware, async (c) => {
  const user = getUser(c)
  const body = await c.req.json()
  const storeName: string = body.storeName?.trim()
  if (!storeName) return c.json({ error: "storeName is required" }, 400)

  const myUser = await getPrisma().user.findUnique({
    where: { id: user.userId },
    select: { plan: true },
  })

  const storeCount = await getPrisma().userStore.count({ where: { userId: user.userId } })
  const plan = myUser?.plan || "FREE"

  const limits: Record<string, number | null> = { FREE: 3, MONTHLY: 10, CUSTOM: null }
  const limit = limits[plan]

  if (limit !== null && storeCount >= limit) {
    return c.json({
      error: plan === "FREE"
        ? `Você atingiu o limite de ${limit} lojas no plano Grátis. Faça upgrade para o plano Mensal ($29/mês) para criar mais lojas.`
        : `Você atingiu o limite de ${limit} lojas no plano Mensal. Contate o suporte para criar mais lojas.`,
    }, 403)
  }

  const pending = await getPrisma().storeRequest.count({
    where: { adminId: user.userId, status: "PENDING" },
  })
  if (pending >= 3) {
    return c.json({ error: "You already have 3 pending requests. Wait for approval before submitting more." }, 429)
  }

  const cd = (body.customizationData as Record<string, any>) || {}
  const hasCustomDomain = !!cd.domain?.trim()

  const req = await getPrisma().storeRequest.create({
    data: {
      storeName,
      adminNotes: body.adminNotes?.trim() || null,
      storefrontType: "INDEPENDENT",
      enableToken: body.enableToken === true,
      customizationData: body.customizationData || undefined,
      adminId: user.userId,
      status: hasCustomDomain ? "PENDING" : "APPROVED",
    },
  })

  // Basic store (no custom domain) → auto-activate immediately
  if (!hasCustomDomain) {
    const actResult = await tryActivateStore(req.id, true)
    const activated = await getPrisma().storeRequest.findUnique({
      where: { id: req.id },
      include: { store: { select: { id: true, name: true, slug: true, domain: true, deploymentUrl: true, deploymentStatus: true, deploymentToken: true } } },
    })
    return c.json({ ...activated, rawToken: actResult.rawToken }, 201)
  }

  // Custom domain → create setup fee Checkout Session (platform Stripe)
  let setupFeePaymentIntentId: string | null = null
  let paymentLink: string | null = null

  const adminUrl = process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "brl",
          product_data: { name: "Taxa de setup — Domínio Personalizado" },
          unit_amount: 300,
        },
        quantity: 1,
      }],
      metadata: { type: "setup_fee", storeRequestId: req.id },
      success_url: `${adminUrl}/admin/stores?payment=success`,
      cancel_url: `${adminUrl}/admin/stores?payment=cancel`,
    })
    setupFeePaymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null
    paymentLink = session.url

    await getPrisma().storeRequest.update({
      where: { id: req.id },
      data: { setupFeePaymentIntentId },
    })
  } catch (err: any) {
    console.error(`[store-requests] Failed to create payment session for ${req.id}:`, err.message)
  }

  return c.json({
    ...req,
    setupFeePaymentIntentId,
    paymentIntentId: setupFeePaymentIntentId,
    paymentLink,
    paymentAmountCents: 300,
  }, 201)
})

// ─── Super admin: list all requests ───
storeRequests.get("/", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const status = c.req.query("status")
  const where: any = {}
  if (status && ["PENDING", "APPROVED", "APPROVED_PENDING_PAYMENT", "REJECTED"].includes(status)) {
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

// ─── Admin: list own requests ───
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

  const enriched = list.map((r) => {
    const cd = (r.customizationData as Record<string, any>) || {}
    const hasCustomDomain = !!cd.domain?.trim()
    return {
      ...r,
      paymentIntentId: r.setupFeePaymentIntentId,
      paymentAmountCents: hasCustomDomain ? 300 : undefined,
    }
  })

  return c.json({ requests: enriched })
})

// ─── Admin: generate a fresh payment link for a pending payment request ───
storeRequests.post("/:id/generate-payment-link", authMiddleware, async (c) => {
  const id = c.req.param("id")!
  const req = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!req) return c.json({ error: "Request not found" }, 404)
  if (req.status !== "APPROVED_PENDING_PAYMENT") return c.json({ error: "Request is not pending payment" }, 400)

  const cd = (req.customizationData as Record<string, any>) || {}
  if (!cd.domain?.trim()) return c.json({ error: "No custom domain — no setup fee required" }, 400)

  const adminUrl = process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "brl",
          product_data: { name: "Taxa de setup — Domínio Personalizado" },
          unit_amount: 300,
        },
        quantity: 1,
      }],
      metadata: { type: "setup_fee", storeRequestId: req.id },
      success_url: `${adminUrl}/admin/stores?payment=success`,
      cancel_url: `${adminUrl}/admin/stores?payment=cancel`,
    })

    const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null

    await getPrisma().storeRequest.update({
      where: { id: req.id },
      data: { setupFeePaymentIntentId: piId },
    })

    return c.json({
      paymentLink: session.url,
      paymentIntentId: piId,
      paymentAmountCents: 300,
    })
  } catch (err: any) {
    return c.json({ error: `Failed to generate payment link: ${err.message}` }, 500)
  }
})

// ─── Super admin: approve a request ───
storeRequests.put("/:id/approve", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const storeRequest = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!storeRequest) return c.json({ error: "Request not found" }, 404)
  if (storeRequest.status !== "PENDING") return c.json({ error: "Request is already processed" }, 400)

  const cd = (storeRequest.customizationData as Record<string, any>) || {}
  const hasCustomDomain = !!cd.domain?.trim()

  // Basic requests (no custom domain) should never reach here — they auto-approve
  if (!hasCustomDomain) {
    const actResult = await tryActivateStore(id, true)
    const activated = await getPrisma().storeRequest.findUnique({
      where: { id },
      include: { store: { select: { id: true, name: true, slug: true, domain: true, deploymentUrl: true, deploymentStatus: true, deploymentToken: true } } },
    })
    return c.json({ ...activated, rawToken: actResult.rawToken })
  }

  // Custom domain: create setup fee Checkout Session
  let paymentLink: string | null = null
  let piId: string | null = null

  const adminUrl = process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "brl",
          product_data: { name: "Taxa de setup — Domínio Personalizado" },
          unit_amount: 300,
        },
        quantity: 1,
      }],
      metadata: { type: "setup_fee", storeRequestId: id },
      success_url: `${adminUrl}/admin/stores?payment=success`,
      cancel_url: `${adminUrl}/admin/stores?payment=cancel`,
    })
    piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null
    paymentLink = session.url
  } catch (err: any) {
    console.error(`[store-requests] Failed to create payment session: ${err.message}`)
  }

  const updated = await getPrisma().storeRequest.update({
    where: { id },
    data: {
      status: "APPROVED_PENDING_PAYMENT",
      setupFeePaymentIntentId: piId,
    },
  })

  // Try to activate immediately (if payment already done)
  const activateResult = await tryActivateStore(id)

  const afterActivate = await getPrisma().storeRequest.findUnique({
    where: { id },
    include: { store: { select: { id: true, name: true, slug: true, domain: true, deploymentUrl: true, deploymentStatus: true, deploymentToken: true } } },
  })

  await logAudit(c, "store-request.approve", "StoreRequest", id, {
    storeName: storeRequest.storeName,
    description: `Solicitação de loja "${storeRequest.storeName}" aprovada`,
  })

  return c.json({
    ...(afterActivate || updated),
    paymentLink,
    paymentIntentId: piId,
    paymentAmountCents: 300,
    rawToken: activateResult.rawToken,
  })
})

// ─── Super admin: reject a request ───
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

  await logAudit(c, "store-request.reject", "StoreRequest", id, {
    storeName: req.storeName,
    reason: body.rejectReason?.trim() || null,
    description: `Solicitação de loja "${req.storeName}" rejeitada`,
  })

  return c.json(updated)
})

// ─── Verify deployment token ───
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

// ─── Get billing status of a store request ───
storeRequests.get("/:id/billing-status", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const req = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!req) return c.json({ error: "Request not found" }, 404)

  return c.json({
    status: req.status,
    setupFeePaid: req.setupFeePaid,
    setupFeePaymentIntentId: req.setupFeePaymentIntentId,
  })
})

// ─── Force activate store (bypass billing checks) ───
storeRequests.post("/:id/force-activate", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const req = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!req) return c.json({ error: "Request not found" }, 404)
  if (req.status !== "APPROVED_PENDING_PAYMENT") return c.json({ error: "Request is not in pending payment status" }, 400)

  const actResult = await tryActivateStore(id, true)

  const updated = await getPrisma().storeRequest.findUnique({
    where: { id },
    include: { store: { select: { id: true, name: true, slug: true, domain: true, deploymentUrl: true, deploymentStatus: true, deploymentToken: true } } },
  })

  await logAudit(c, "store-request.force-activate", "StoreRequest", id, {
    storeName: req.storeName,
    description: `Solicitação de loja "${req.storeName}" forçada a ativar`,
  })

  if (actResult.activated) {
    return c.json({ success: true, status: "APPROVED", rawToken: actResult.rawToken, store: updated?.store })
  }
  return c.json({ success: false, status: updated?.status })
})

// ─── Check deployment status ───
storeRequests.post("/:id/check-deployment", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const req = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!req) return c.json({ error: "Request not found" }, 404)
  if (!req.storeId) return c.json({ error: "Store not yet created for this request" }, 400)

  const store = await getPrisma().store.findUnique({ where: { id: req.storeId } })
  if (!store) return c.json({ error: "Store not found" }, 404)

  const url = store.deploymentUrl || buildStoreUrl(store.slug)
  const status = await checkDeployment(url)

  await getPrisma().store.update({
    where: { id: store.id },
    data: { deploymentStatus: status },
  })

  await logAudit(c, "store-request.check-deployment", "StoreRequest", id, {
    storeName: req.storeName,
    deploymentStatus: status,
    description: `Deployment verificado para "${req.storeName}": ${status}`,
  })

  return c.json({ deploymentUrl: url, deploymentStatus: status })
})

export { tryActivateStore }
export default storeRequests
