# whatever-ecommerce-backend

API central do ecossistema multi-loja. Servidor Hono.js rodando em serverless functions na Vercel.

## Função

- **Autenticação** — JWT (login/register/me) com roles CUSTOMER, ADMIN, SUPER_ADMIN
- **Multi-tenancy** — Cada loja isolada por `storeId` via middleware de contexto
- **Loja** — CRUD de lojas, domínios, branding, token de deploy
- **Store Requests** — Fluxo de solicitação + aprovação de novas lojas independentes
- **Produtos** — CRUD com imagens (Cloudinary), categorias, inventário
- **Carrinho & Checkout** — Carrinho persistido + checkout Stripe
- **Pedidos** — CRUD com eventos de status, rastreamento DHL
- **Configurações** — Key-value por loja (Setting)

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | Hono.js |
| ORM | Prisma + Neon PostgreSQL |
| Auth | JWT (bcryptjs + jose) |
| Pagamentos | Stripe |
| Imagens | Cloudinary |
| Cache/Limiter | Upstash Redis |
| Envio | DHL Express |
| DNS | Cloudflare API |
| Deploy | Vercel (serverless functions) |
