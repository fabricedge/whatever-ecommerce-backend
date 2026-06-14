# DHL Express Integration Setup

## Prerequisites

1. **DHL Express customer account** (commercial contract)
2. **API credentials** from the [DHL Developer Portal](https://developer.dhl.com/user/login)
   - Username (API Key)
   - Password (API Secret)
3. **Shipper account number** (DHL Express account number)

## Architecture

```
Admin Panel → Backend (Hono) → DHL MyDHL API (express.api.dhl.com)
```

All DHL communication goes through the backend. The admin never calls DHL directly.

## Environment Variables

In `whatever-ecommerce-backend/.env`:

```env
DHL_API_URL=https://express.api.dhl.com/mydhlapi/test
DHL_API_KEY=your_api_key
DHL_API_SECRET=your_api_secret
DHL_SHIPPER_ACCOUNT_NUMBER=your_account_number
```

For production, change `DHL_API_URL` to:
```env
DHL_API_URL=https://express.api.dhl.com/mydhlapi
```

## DHL Origin Address

Configured in the Super Admin → Settings → **DHL Express** section:

| Field | Setting Key | Example |
|---|---|---|
| CEP de origem | `dhl_origin_zip` | 01001000 |
| Cidade de origem | `dhl_origin_city` | São Paulo |
| Endereço de origem | `dhl_origin_address` | Rua Exemplo, 100 |

These are stored per-store in the `Setting` table.

## Files Reference

### Backend (`whatever-ecommerce-backend/`)

| File | Purpose |
|---|---|
| `src/lib/dhl.ts` | DHL API client: `getRates()`, `createShipment()`, `trackShipment()`, `isDHLConfigured()` |
| `src/routes/shipping.ts` | REST endpoints: `POST /rates`, `POST /label`, `GET /tracking/:code`, `GET /status` |
| `prisma/schema.prisma` | Order model has: `trackingCode`, `shippingLabelB64`, `shippingProduct`, `shippingWeight/Length/Width/Height`, `shippingPrice` |

### Admin (`svelte-admin/`)

| File | Purpose |
|---|---|
| `src/lib/api/shipping.ts` | API client for shipping endpoints |
| `src/routes/admin/orders/[id]/+page.svelte` | DHL card in order detail: dimensions input, rate calculation, label generation, tracking |
| `src/routes/superadmin/settings/+page.svelte` | DHL origin address configuration |

## DHL MyDHL API Endpoints Used

| Endpoint | Used For |
|---|---|
| `POST /rates` | Calculate shipping rates and delivery times |
| `POST /shipments` | Generate shipping labels |
| `GET /tracking` | Track shipment status |

See: https://developer.dhl.com/api-reference/mydhl-api-dhl-express

## Testing

1. Set `DHL_API_URL` to sandbox endpoint
2. Set origin address in Super Admin → Settings → DHL Express
3. Open a PAID order in the admin
4. Fill in package dimensions (default: 0.5kg, 20x15x10cm)
5. Click **"Calcular frete DHL"** → shows available products + prices
6. Select a product → click **"Gerar etiqueta DHL"** → generates label
7. Download PDF label → tracking code saved on order

## Troubleshooting

### DHL card doesn't appear in order detail
→ `GET /api/shipping/status` returns `{"configured":false}`
→ Check env vars are set and server was restarted

### "Invalid Credentials" (401) from DHL
→ API credentials are wrong or not activated
→ Complete onboarding at https://developer.dhl.com/user/login
→ Credentials format: Basic Auth username/password

### "Invalid client" from DHL auth
→ Client ID/Secret are for a different DHL API
→ Only MyDHL API credentials work with this integration

## Moving to Production

1. Change `DHL_API_URL` to production endpoint
2. Ensure DHL origin address is correct
3. Verify DHL Express account has sufficient funds
4. Test with a real shipment
5. Enable pickup requests (`POST /pickups`) if needed
