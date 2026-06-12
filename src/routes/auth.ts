import { Hono } from "hono"
import { z } from "zod"
import { hashSync, compare } from "bcryptjs"
import { prisma } from "../lib/prisma.js"
import { signToken } from "../lib/jwt.js"
import { authMiddleware, getUser } from "../lib/auth-middleware.js"

const auth = new Hono()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

auth.post("/register", async (c) => {
  const body = await c.req.json()
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "Dados inválidos", details: parsed.error }, 400)

  const { email, password, name } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return c.json({ error: "Email já cadastrado" }, 409)

  const user = await prisma.user.create({
    data: { email, passwordHash: hashSync(password, 10), name, role: "CUSTOMER" },
  })

  const token = await signToken({ userId: user.id, role: user.role, email: user.email })
  return c.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201)
})

auth.post("/login", async (c) => {
  const body = await c.req.json()
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400)

  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.passwordHash) return c.json({ error: "Credenciais inválidas" }, 401)

  const valid = await compare(password, user.passwordHash)
  if (!valid) return c.json({ error: "Credenciais inválidas" }, 401)

  const token = await signToken({ userId: user.id, role: user.role, email: user.email })
  return c.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } })
})

auth.get("/me", authMiddleware, async (c) => {
  const user = getUser(c)
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { id: true, email: true, name: true, role: true },
  })
  return c.json({ user: dbUser })
})

export default auth
