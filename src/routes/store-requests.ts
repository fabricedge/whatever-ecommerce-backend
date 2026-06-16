import { Hono } from "hono"
import { hashSync, compare } from "bcryptjs"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"
import { deployStorefront } from "../services/vercel.js"
import { createDnsRecord, deleteDnsRecord } from "../services/cloudflare.js"
import { createConnectedAccount, createAccountLink } from "../services/stripe-connect.js"
import { getStripe } from "../lib/stripe.js"

const storeRequests = new Hono()

// ─── Shared: activate store after billing conditions met ───
async function tryActivateStore(requestId: string) {
  const req = await getPrisma().storeRequest.findUnique({ where: { id: requestId } })
  if (!req) return
  if (req.status !== "APPROVED_PENDING_PAYMENT") return
  if (req.storefrontType === "INDEPENDENT" && !req.setupFeePaid) return
  if (!req.connectOnboardingComplete) return

  const slug = req.storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "loja"
  const cd = (req.customizationData as Record<string, any>) || {}
  const customDomain = cd.domain?.trim()
  const finalDomain = customDomain || `${slug}.fskk.site`

  let dnsRecordId: string | null = null
  if (req.storefrontType === "INDEPENDENT") {
    try {
      const dns = await createDnsRecord(slug)
      dnsRecordId = dns.id
    } catch (err: any) {
      console.error(`[tryActivateStore] DNS failed for ${requestId}:`, err.message)
      return
    }
  }

  try {
    const store = await getPrisma().store.create({
      data: {
        name: req.storeName,
        slug,
        storefrontType: req.storefrontType,
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

    let rawToken: string | undefined
    if (req.storefrontType === "INDEPENDENT") {
      const result = await deployStorefront(store.id, slug, req.enableToken)
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
      data: { userId: req.adminId, storeId: store.id },
    })

    await getPrisma().storeRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", storeId: store.id },
    })
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

  return c.json({ requests: list })
})

// ─── Super admin: approve a request ───
// For DEFAULT stores: creates Connect account + onboarding link (no setup fee)
// For INDEPENDENT stores: creates Connect account + setup fee, awaits payment + onboarding
storeRequests.put("/:id/approve", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const id = c.req.param("id")!
  const storeRequest = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (!storeRequest) return c.json({ error: "Request not found" }, 404)
  if (storeRequest.status !== "PENDING") return c.json({ error: "Request is already processed" }, 400)

  // DEFAULT stores: create Connect account + onboarding link (no setup fee)
  if (storeRequest.storefrontType === "DEFAULT") {
    const cd = (storeRequest.customizationData as Record<string, any>) || {}
    const customDomain = cd.domain?.trim()
    const slug = storeRequest.storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "loja"
    const finalDomain = customDomain || `${slug}.fskk.site`

    let stripeConnectAccountId = storeRequest.stripeConnectAccountId
    let onboardingUrl: string | null = null

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
      const refreshUrl = `${process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"}/superadmin/store-requests`
      const returnUrl = `${process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"}/superadmin/store-requests/${id}`
      const link = await createAccountLink(stripeConnectAccountId, refreshUrl, returnUrl)
      onboardingUrl = link.url
    } catch (err: any) {
      return c.json({ error: `Failed to create Connect onboarding link: ${err.message}` }, 500)
    }

    const updated = await getPrisma().storeRequest.update({
      where: { id },
      data: {
        status: "APPROVED_PENDING_PAYMENT",
        stripeConnectAccountId,
        connectOnboardingUrl: onboardingUrl,
      },
    })

    return c.json({
      ...updated,
      onboardingUrl,
    })
  }

  // INDEPENDENT stores: create Connect account + setup fee payment
  const cd = (storeRequest.customizationData as Record<string, any>) || {}
  const customDomain = cd.domain?.trim()
  const slug = storeRequest.storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "loja"
  const finalDomain = customDomain || `${slug}.fskk.site`

  let stripeConnectAccountId = storeRequest.stripeConnectAccountId
  let onboardingUrl: string | null = null

  // 1. Create Stripe Connect Express account if not already created
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

  // 2. Generate onboarding link
  try {
    const refreshUrl = `${process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"}/superadmin/store-requests`
    const returnUrl = `${process.env.PUBLIC_ADMIN_URL || "https://stadmin.fskk.site"}/superadmin/store-requests/${id}`
    const link = await createAccountLink(stripeConnectAccountId, refreshUrl, returnUrl)
    onboardingUrl = link.url
  } catch (err: any) {
    return c.json({ error: `Failed to create Connect onboarding link: ${err.message}` }, 500)
  }

  // 3. Create PaymentIntent for R$3 setup fee
  let setupFeePaymentIntentId: string | null = null
  try {
    const stripe = getStripe()
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 300,
      currency: "brl",
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      metadata: {
        type: "setup_fee",
        storeRequestId: id,
      },
    })
    setupFeePaymentIntentId = paymentIntent.id
  } catch (err: any) {
    return c.json({ error: `Failed to create setup fee payment: ${err.message}` }, 500)
  }

  // 4. Update store request to APPROVED_PENDING_PAYMENT
  const updated = await getPrisma().storeRequest.update({
    where: { id },
    data: {
      status: "APPROVED_PENDING_PAYMENT",
      stripeConnectAccountId,
      connectOnboardingUrl: onboardingUrl,
      setupFeePaymentIntentId,
    },
  })

  return c.json({
    ...updated,
    onboardingUrl,
    paymentIntentId: setupFeePaymentIntentId,
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

  await tryActivateStore(id)

  const updated = await getPrisma().storeRequest.findUnique({ where: { id } })
  if (updated?.status === "APPROVED") {
    return c.json({ success: true, status: "APPROVED" })
  }
  return c.json({ success: false, status: updated?.status })
})

export { tryActivateStore }
export default storeRequests
