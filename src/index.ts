import { Hono } from "hono"
import { cors } from "hono/cors"
import auth from "./routes/auth.js"
import products from "./routes/products.js"
import cart from "./routes/cart.js"
import checkout from "./routes/checkout.js"
import checkoutSession from "./routes/checkout-session.js"
import orders from "./routes/orders.js"
import webhooks from "./routes/webhooks.js"
import users from "./routes/users.js"
import settings from "./routes/settings.js"
import stores from "./routes/stores.js"
import storeRequests from "./routes/store-requests.js"
import shipping from "./routes/shipping.js"
import upload from "./routes/upload.js"
import { storeMiddleware } from "./lib/store-middleware.js"
import { generalLimiter, authLimiter, uploadLimiter } from "./lib/rate-limiter.js"

const app = new Hono()

app.use("*", cors({
  origin: "*",
  credentials: true,
}))

// Store middleware scopes requests to a store (default: "minha-loja" if no X-Store-Id)
app.use("*", storeMiddleware)

// Rate limiting
app.use("*", generalLimiter)
app.use("/api/auth/*", authLimiter)
app.use("/api/upload*", uploadLimiter)

app.route("/api/auth", auth)
app.route("/api/products", products)
app.route("/api/cart", cart)
app.route("/api/checkout", checkout)
app.route("/api/create-checkout-session", checkoutSession)
app.route("/api/orders", orders)
app.route("/api/webhooks", webhooks)
app.route("/api/users", users)
app.route("/api/settings", settings)
app.route("/api/stores", stores)
app.route("/api/store-requests", storeRequests)
app.route("/api/shipping", shipping)
app.route("/api/upload", upload)

app.onError((err, c) => {
  console.error("Unhandled error:", err)
  return c.json({ error: "Erro interno do servidor" }, 500)
})

app.get("/api/health", (c) => c.json({ status: "ok" }))

export default app
