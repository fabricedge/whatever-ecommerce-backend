import { Hono } from "hono"
import { hashSync, compare } from "bcryptjs"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"
import { deployStorefront } from "../services/vercel.js"
import { createDnsRecord, deleteDnsRecord } from "../services/cloudflare.js"
import { createConnectedAccount, createAccountLink } from "../services/stripe-connect.js"
import { getStripe } from "../lib/stripe.js"
import { checkDeployment, buildStoreUrl } from "../lib/deployment.js"

const storeRequests = new Hono()

// ─── Shared: activate store after billing conditions met ───
async function tryActivateStore(requestId: string, force = false) {
  const req = await getPrisma().storeRequest.findUnique({ where: { id: requestId } })
  if (!req) return
  if (req.status !== "APPROVED" && req.status !== "APPROVED_PENDING_PAYMENT") return

  const cd = (req.customizationData as Record<string, any>) || {}
  const hasCustomDomain = !!cd.domain?.trim()

  if (!force && hasCustomDomain) {
    if (!req.setupFeePaid) return
    if (!req.connectOnboardingComplete) return
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
        stripeConnectAccountId: req.stripeConnectAccountId,
        connectOnboardingComplete: req.connectOnboardingComplete,
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

    const result = await deployStorefront(store.id, slug, req.enableToken)
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

    // Try health check (non-blocking, with retries)
    ;(async () => {
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const status = await checkDeployment(buildStoreUrl(slug))
        if (status === 'READY') {
          await getPrisma().store.update({
            where: { id: store.id },
            data: { deploymentStatus: 'READY' },
          })
          return
        }
      }
      await getPrisma().store.update({
        where: { id: store.id },
        data: { deploymentStatus: 'FAILED' },
      })
    })()
  } catch (err: any) {
    console.error(`[tryActivateStore] creation failed for ${requestId}:`, err.message)
    if (dnsRecordId) {
      try { await deleteDnsRecord(dnsRecordId) } catch {}
    }
  }
}

// ─── Admin: submit a new store request ───
storeRequests.post("/", authMiddleware, adminMiddleware, async (c) => {
  const user = getUser(c)
  const body = await c.req.json()
  const storeName: string = body.storeName?.trim()
  if (!storeName) return c.json({ error: "storeName is required" }, 400)

  // Check store limit by user plan
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
    await tryActivateStore(req.id, true)
    const activated = await getPrisma().storeRequest.findUnique({ where: { id: req.id } })
    return c.json({ ...activated }, 201)
  }

  // Custom domain → create Connect account + setup fee Checkout Session
  let stripeConnectAccountId: string | null = null
  let connectOnboardingUrl: string | null = null
  let setupFeePaymentIntentId: string | null = null
  let paymentLink: string | null = null

  const slug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "loja"
  const adminUrl = process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"
  const finalDomain = cd.domain.trim()

  try {
    const account = await createConnectedAccount(storeName, user.email, `https://${finalDomain}`)
    stripeConnectAccountId = account.id

    const refreshUrl = `${adminUrl}/admin/stores`
    const returnUrl = `${adminUrl}/admin/stores`
    const link = await createAccountLink(stripeConnectAccountId, refreshUrl, returnUrl)
    connectOnboardingUrl = link.url

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
      data: { stripeConnectAccountId, connectOnboardingUrl, setupFeePaymentIntentId },
    })
  } catch (err: any) {
    console.error(`[store-requests] Failed to create Connect/PaymentIntent for ${req.id}:`, err.message)
  }

  return c.json({
    ...req,
    stripeConnectAccountId,
    connectOnboardingUrl,
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
    await tryActivateStore(id, true)
    const activated = await getPrisma().storeRequest.findUnique({ where: { id } })
    return c.json({ ...activated })
  }

  // Custom domain: create Connect account + onboarding + checkout
  let stripeConnectAccountId = storeRequest.stripeConnectAccountId
  let onboardingUrl: string | null = null
  let paymentLink: string | null = null
  let piId: string | null = null

  const adminUrl = process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"
  const finalDomain = cd.domain.trim()

  if (!stripeConnectAccountId) {
    try {
      const admin = await getPrisma().user.findUnique({ where: { id: storeRequest.adminId } })
      const account = await createConnectedAccount(
        storeRequest.storeName,
        admin?.email || "admin@example.com",
        `https://${finalDomain}`
      )
      stripeConnectAccountId = account.id
    } catch (err: any) {
      return c.json({ error: `Failed to create Stripe Connect account: ${err.message}` }, 500)
    }
  }

  try {
    const refreshUrl = `${adminUrl}/admin/stores`
    const returnUrl = `${adminUrl}/admin/stores`
    const link = await createAccountLink(stripeConnectAccountId, refreshUrl, returnUrl)
    onboardingUrl = link.url

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
    return c.json({ error: `Failed to create payment session: ${err.message}` }, 500)
  }

  const updated = await getPrisma().storeRequest.update({
    where: { id },
    data: {
      status: "APPROVED_PENDING_PAYMENT",
      stripeConnectAccountId,
      connectOnboardingUrl: onboardingUrl,
      setupFeePaymentIntentId: piId,
    },
  })

  // Try to activate immediately (if payment + onboarding already done)
  await tryActivateStore(id)

  const afterActivate = await getPrisma().storeRequest.findUnique({ where: { id } })

  return c.json({
    ...(afterActivate || updated),
    onboardingUrl,
    paymentLink,
    paymentIntentId: piId,
    paymentAmountCents: 300,
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
    connectOnboardingComplete: req.connectOnboardingComplete,
    stripeConnectAccountId: req.stripeConnectAccountId,
    connectOnboardingUrl: req.connectOnboardingUrl,
  })
})

// ─── Refresh onboarding link (previous one expires in 1h) ───
storeRequests.post("/:id/refresh-onboarding-link", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const req = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!req) return c.json({ error: "Request not found" }, 404)
  if (!req.stripeConnectAccountId) return c.json({ error: "No Connect account created yet" }, 400)

  try {
    const refreshUrl = `${process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"}/superadmin/store-requests`
    const returnUrl = `${process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"}/superadmin/store-requests/${id}`
    const link = await createAccountLink(req.stripeConnectAccountId, refreshUrl, returnUrl)

    await getPrisma().storeRequest.update({
      where: { id },
      data: { connectOnboardingUrl: link.url },
    })

    return c.json({ onboardingUrl: link.url })
  } catch (err: any) {
    return c.json({ error: `Failed to refresh onboarding link: ${err.message}` }, 500)
  }
})

// ─── Force activate store (bypass billing checks) ───
storeRequests.post("/:id/force-activate", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const req = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!req) return c.json({ error: "Request not found" }, 404)
  if (req.status !== "APPROVED_PENDING_PAYMENT") return c.json({ error: "Request is not in pending payment status" }, 400)

  await tryActivateStore(id, true)

  const updated = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (updated?.status === "APPROVED") {
    return c.json({ success: true, status: "APPROVED" })
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

  return c.json({ deploymentUrl: url, deploymentStatus: status })
})

export { tryActivateStore }
export default storeRequests
