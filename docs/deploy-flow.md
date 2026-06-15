# Fluxo de Deploy — Backend (Hono API)

Este documento descreve como uma loja independente é criada do zero até ficar acessível.

```
Admin                         Super Admin                  Cloudflare                  Vercel
  │                              │                             │                         │
  │ POST /api/store-requests     │                             │                         │
  │ { storefrontType,            │                             │                         │
  │   customizationData }        │                             │                         │
  │ ─────────────────────────►   │                             │                         │
  │                              │                             │                         │
  │                    PUT /:id/approve                        │                         │
  │                              │ ──────────────────────────► │                         │
  │                              │   POST /dns_records         │                         │
  │                              │   (A record: {slug} →       │                         │
  │                              │    76.76.21.21)             │                         │
  │                              │ ◄────────────────────────── │                         │
  │                              │   { id, success }           │                         │
  │                              │                             │                         │
  │                              │ ─── Cria Store no banco ─── │                         │
  │                              │ ─── Aplica branding ─────── │                         │
  │                              │ ─── Gera token de acesso ── │                         │
  │                              │                             │                         │
  │                              │   DNS propagado             │  Usuário acessa          │
  │                              │ ◄────────────────────────── │ {slug}.fskk.site        │
  │                              │                             │ ─────────────────────►   │
  │                              │                             │                         │
  │                              │                             │   GET /api/stores/       │
  │                              │                             │   lookup?domain=...      │
  │                              │                             │ ◄────────────────────    │
  │                              │                             │   { id, name, slug }     │
  │                              │                             │ ────────────────────►    │
```

## Etapas detalhadas

### 1. Admin submete solicitação

`POST /api/store-requests` (autenticado como ADMIN ou SUPER_ADMIN)

```json
{
  "storeName": "Minha Loja",
  "storefrontType": "INDEPENDENT",
  "enableToken": true,
  "customizationData": {
    "primaryColor": "#FF6600",
    "secondaryColor": "#0044CC",
    "logoUrl": "https://...",
    "faviconUrl": "https://...",
    "fontFamily": "Roboto",
    "domain": "meudominio.com.br"
  }
}
```

- `storefrontType: "INDEPENDENT"` → loja com subdomínio próprio
- `enableToken: true` → gera código de acesso de 6 dígitos
- `customizationData` → branding + domínio customizado (opcional)
- Limite de 3 solicitações PENDING por admin

### 2. Super admin aprova

`PUT /api/store-requests/:id/approve` (autenticado como SUPER_ADMIN)

```typescript
// 1. Extrai slug do storeName
slug = "minha-loja"

// 2. Define domínio final
subdomainDomain = `${slug}.fskk.site`  // "minha-loja.fskk.site"
finalDomain = customDomain || subdomainDomain

// 3. Cria DNS (se INDEPENDENT)
createDnsRecord(slug)
// → Cria A record: minha-loja.fskk.site → 76.76.21.21 (TTL 120s)

// 4. Cria Store no banco
store = prisma.store.create({
  slug, domain: finalDomain, storefrontType: "INDEPENDENT"
})

// 5. Aplica branding
prisma.setting.upsert({ key: "branding_primary_color", value: "#FF6600" })
prisma.setting.upsert({ key: "branding_secondary_color", value: "#0044CC" })
// ...

// 6. Gera deployment + token
deployUrl = `https://${slug}.fskk.site`
tokenHash = hashSync(randomToken)

// 7. Rollback: se algo falhar, deleta o DNS record
```

**Rollback**: se qualquer etapa após a criação do DNS falhar, o DNS record é deletado automaticamente.

### 3. DNS propaga

`minha-loja.fskk.site` resolve para `76.76.21.21` (Vercel anycast IP). DNS-only (não proxied pelo Cloudflare).

### 4. Vercel roteia

O wildcard `*.fskk.site` está configurado no projeto storefront da Vercel. Vercel emite certificado SSL wildcard automaticamente.

Requisição chega em `https://minha-loja.fskk.site`:
- SSL: wildcard `*.fskk.site` cobre o subdomínio
- Storefront: lê `Host: minha-loja.fskk.site`

### 5. Storefront carrega dados

```
GET /api/stores/lookup?domain=minha-loja.fskk.site
  → { id, name, slug }

GET /api/stores/:id/branding
  → { store: {…}, branding: { primary_color, … } }

GET /api/stores/:id/has-token
  → { hasToken: true }
```

Se `hasToken: true`, exibe tela de acesso com código de 6 dígitos.

### 6. Token gate

O código é verificado via:

```
POST /api/store-requests/verify-token
{ storeId, code: "123456" }
  → { valid: true/false }
```

Endpoint público (não requer auth). Compara o hash armazenado com bcrypt.

## Requisitos de ambiente

| Variável | Origem | Uso |
|----------|--------|-----|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | Criar A records DNS |
| `CLOUDFLARE_ZONE_ID` | Cloudflare (c55cc33d97068fc733e7ebae266b1e50) | Escopo da zona |
| `PUBLIC_STORE_URL` | Vercel env | URL base do storefront |
| `DATABASE_URL` | Neon | Conexão PostgreSQL |
| `JWT_SECRET` | Gerado localmente | Assinatura de tokens |

## Variantes

- **Sem custom domain**: `domain = slug.fskk.site`, o cliente acessa via `slug.fskk.site`
- **Com custom domain**: `domain = meudominio.com.br`, o A record do slug continua existindo para acesso interno, mas o lookup usa o domínio customizado
- **DEFAULT storefront**: não cria DNS, não gera token, usa ?store=id
