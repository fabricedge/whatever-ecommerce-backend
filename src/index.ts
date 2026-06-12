import { Hono } from "hono"
import { cors } from "hono/cors"
import auth from "./routes/auth.js"
import products from "./routes/products.js"
import cart from "./routes/cart.js"
import checkout from "./routes/checkout.js"
import orders from "./routes/orders.js"
import webhooks from "./routes/webhooks.js"

const app = new Hono()

app.use("*", cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true,
}))

app.route("/api/auth", auth)
app.route("/api/products", products)
app.route("/api/cart", cart)
app.route("/api/checkout", checkout)
app.route("/api/orders", orders)
app.route("/api/webhooks", webhooks)

app.onError((err, c) => {
  console.error("Unhandled error:", err)
  return c.json({ error: "Erro interno" }, 500)
})

app.get("/api/health", (c) => c.json({ status: "ok" }))

export default app
