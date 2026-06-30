import { Hono } from "hono"
import { Context } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"
import { encrypt, decrypt } from "../lib/encryption.js"
import { logAudit } from "../lib/audit-log.js"
import { initPlatformStripe, getStripeWithKey } from "../lib/stripe.js"
import bcrypt from "bcryptjs"

const SENSITIVE_PREFIXES = ["easyship_"]
const MASK_VALUE = "__SET__"

function isSensitive(key: string): boolean {
  return SENSITIVE_PREFIXES.some((p) => key.startsWith(p))
}

const settings = new Hono()

function getStoreId(c: Context): string {
  return c.get("storeId")!
}

settings.get("/", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const all = await getPrisma().setting.findMany({ where: { storeId } })
  const result: Record<string, string> = {}
  for (const s of all) result[s.key] = isSensitive(s.key) ? MASK_VALUE : s.value
  return c.json({ settings: result })
})

settings.put("/", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()

  await Promise.all(
    Object.entries(body).map(([key, value]) => {
      const raw = String(value)
      const stored = isSensitive(key) ? encrypt(raw) : raw
      return getPrisma().setting.upsert({
        where: { storeId_key: { storeId, key } },
        update: { value: stored },
        create: { storeId, key, value: stored },
      })
    })
  )

  if (body.store_domain !== undefined) {
    await getPrisma().store.update({
      where: { id: storeId },
      data: { domain: String(body.store_domain) || null },
    })
  }

  return c.json({ success: true })
})

// SUPER_ADMIN only: toggle multi-store feature
settings.put("/multi-store", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const body = await c.req.json()
  const enabled = body.enabled === true

  await getPrisma().store.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", name: "Global", slug: "global", isActive: true, storefrontType: "DEFAULT" },
  })

  await getPrisma().setting.upsert({
    where: { storeId_key: { storeId: "global", key: "multi_store_enabled" } },
    update: { value: String(enabled) },
    create: { storeId: "global", key: "multi_store_enabled", value: String(enabled) },
  })

  await logAudit(c, "settings.multi-store.toggle", "Setting", "global", {
    enabled,
    description: `Multi-store ${enabled ? "ativado" : "desativado"}`,
  })

  return c.json({ multi_store_enabled: enabled })
})

// SUPER_ADMIN only: check multi-store status
settings.get("/multi-store", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const setting = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId: "global", key: "multi_store_enabled" } },
  })

  return c.json({ multi_store_enabled: setting?.value === "true" })
})

const PLATFORM_SENSITIVE = ["stripe_secret_key", "stripe_publishable_key"]

// ─── SUPER_ADMIN: get platform settings ───
settings.get("/platform", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const all = await getPrisma().platformSetting.findMany()
  const result: Record<string, string> = {}
  for (const s of all) {
    result[s.key] = PLATFORM_SENSITIVE.includes(s.key) ? "__SET__" : s.value
  }
  return c.json(result)
})

// ─── SUPER_ADMIN: update platform settings ───
settings.put("/platform", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const body = await c.req.json()

  await Promise.all(
    Object.entries(body).map(([key, value]) => {
      const raw = String(value)
      if (raw === "__SET__") return // skip unchanged masked values
      const stored = PLATFORM_SENSITIVE.includes(key) ? encrypt(raw) : raw
      return getPrisma().platformSetting.upsert({
        where: { key },
        update: { value: stored },
        create: { key, value: stored },
      })
    })
  )

  // If stripe secret key was updated, re-init the Stripe singleton
  if (body.stripe_secret_key && body.stripe_secret_key !== "__SET__") {
    initPlatformStripe(String(body.stripe_secret_key))
  }

  await logAudit(c, "settings.platform.update", "PlatformSetting", "platform", {
    keys: Object.keys(body),
    description: `Configurações de pagamento da plataforma atualizadas`,
  })

  return c.json({ success: true })
})

// ─── SUPER_ADMIN: test Stripe connection ───
settings.post("/platform/test-connection", authMiddleware, async (c) => {
  const user = getUser(c)
  if (user.role !== "SUPER_ADMIN") return c.json({ error: "Forbidden" }, 403)

  const body = await c.req.json()
  const key = String(body.secret_key || "").trim()
  if (!key) return c.json({ error: "Secret key is required" }, 400)

  try {
    const stripe = getStripeWithKey(key)
    const account = await stripe.accounts.retrieve("acct_plat")
    return c.json({ success: true, account: account.id })
  } catch {
    // If acct_plat doesn't exist (expected for new accounts), test with balance
    try {
      const stripe = getStripeWithKey(key)
      const balance = await stripe.balance.retrieve()
      return c.json({ success: true, balance: balance.available[0]?.amount || 0 })
    } catch (err: any) {
      return c.json({ success: false, error: err.message })
    }
  }
})

// ─── Reveal a sensitive setting (admin password required) ───
settings.post("/reveal", authMiddleware, adminMiddleware, async (c) => {
  const user = getUser(c)
  const storeId = getStoreId(c)
  const { key, password } = await c.req.json()

  if (!key || !password) return c.json({ error: "key e password são obrigatórios" }, 400)

  const dbUser = await getPrisma().user.findUnique({ where: { id: user.userId } })
  if (!dbUser?.passwordHash) return c.json({ error: "Usuário não encontrado" }, 404)

  const valid = await bcrypt.compare(password, dbUser.passwordHash)
  if (!valid) return c.json({ error: "Senha incorreta" }, 401)

  const setting = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId, key } },
  })
  if (!setting) return c.json({ error: "Configuração não encontrada" }, 404)

  const value = isSensitive(key) ? decrypt(setting.value) : setting.value
  return c.json({ key, value })
})

// ─── Public: get storefront-facing settings (no auth required) ───
settings.get("/public", async (c) => {
  const storeId = c.get("storeId") as string | undefined
  if (!storeId) return c.json({ error: "storeId não encontrado" }, 400)

  const all = await getPrisma().setting.findMany({
    where: { storeId, key: { in: ["origin_country", "store_name", "store_currency", "store_locale", "branding_primary_color", "branding_secondary_color", "branding_logo_url", "branding_favicon_url", "branding_font_family"] } },
  })
  const result: Record<string, string> = {}
  for (const s of all) result[s.key] = s.value
  return c.json(result)
})

export default settings
