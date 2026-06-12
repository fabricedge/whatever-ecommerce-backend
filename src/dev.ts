import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { serve } from "@hono/node-server"
import app from "./index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, "..", ".env") })

const port = process.env.PORT || 3001
console.log(`Backend rodando em http://localhost:${port} [env: ${process.env.JWT_SECRET ? "loaded" : "missing"}]`)

serve({ fetch: app.fetch, port: Number(port) })
