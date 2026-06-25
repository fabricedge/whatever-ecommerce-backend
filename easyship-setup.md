# Shippo Integration

## Prerequisites

1. **Shippo account** — sign up at https://goshippo.com
2. **API key** — generate at https://goshippo.com/user/apikeys/
   - Use `shippo_test_...` for development
   - Use `shippo_live_...` for production
3. **Carrier accounts** — connect carriers in the Shippo dashboard:
   - CorreiosBR (domestic Brazil)
   - DHL Express (international)
   - FedEx, UPS, etc.

## Architecture

```
Admin Panel                     Backend (Hono)              Shippo API
    │                               │                           │
    ├── GET  /shipping/status ──────┤                           │
    ├── POST /shipping/rates  ──────┼── shippo.shipments.create() ──► rates[]
    ├── POST /shipping/label  ──────┼── shippo.transactions.create()──► label URL + tracking
    └── GET  /shipping/tracking/:code ── shippo.trackingStatus.get()──► tracking events
```

## Environment Variables

```env
SHIPPO_API_KEY=shippo_test_...  # or shippo_live_...
```

## Origin Address Configuration

Set per-store in **Super Admin → Settings → Transportadora (Shippo)**:

| Setting Key        | Description         | Default        |
|--------------------|---------------------|----------------|
| `origin_name`      | Shipper name        | `Loja`         |
| `origin_company`   | Company name        | —              |
| `origin_phone`     | Phone number        | `11999999999`  |
| `origin_email`     | Email               | `loja@exemplo.com` |
| `origin_street`    | Street address      | `Rua Exemplo, 100` |
| `origin_city`      | City                | `São Paulo`    |
| `origin_state`     | State               | `SP`           |
| `origin_zip`       | ZIP/CEP             | `01001000`     |
| `origin_country`   | Country code        | `BR`           |

## API Endpoints

### `GET /api/shipping/status`

Returns `{ configured: boolean }` — checks if `SHIPPO_API_KEY` is set.

### `POST /api/shipping/rates`

Calculate available shipping rates for an order.

**Request:**
```json
{
  "orderId": "ckl...",
  "weight": 0.5,
  "length": 20,
  "width": 15,
  "height": 10
}
```

**Response:**
```json
{
  "products": [
    {
      "rateId": "abc123...",
      "provider": "CorreiosBR",
      "serviceLevelName": "PAC",
      "serviceLevelToken": "correios_br_pac",
      "amount": 25.90,
      "currency": "BRL",
      "estimatedDays": "5"
    }
  ]
}
```

### `POST /api/shipping/label`

Purchase a shipping label from a selected rate.

**Request:**
```json
{
  "orderId": "ckl...",
  "rateId": "abc123..."
}
```

**Response:**
```json
{
  "trackingNumber": "BR123456789BR",
  "labelUrl": "https://shippo-delivery.s3.amazonaws.com/...pdf",
  "carrier": "CorreiosBR",
  "serviceLevel": "PAC",
  "trackingUrlProvider": "https://...",
  "error": null
}
```

### `GET /api/shipping/tracking/:code?carrier=correios_br`

Track a shipment.

**Response:**
```json
{
  "trackingNumber": "BR123456789BR",
  "status": "TRANSIT",
  "estimatedDeliveryDate": "2026-07-01T00:00:00Z",
  "events": [
    {
      "timestamp": "2026-06-28T10:00:00Z",
      "location": "São Paulo",
      "status": "PRE_TRANSIT",
      "description": "Shipment information received"
    }
  ]
}
```

## Testing with Shippo Test Mode

Use a `shippo_test_...` API key. Shippo test mode simulates all API calls without real charges.

### Test Tracking Numbers

Use Shippo's predefined test tracking numbers for different statuses:
- `SHIPPO_TRANSIT` — in transit
- `SHIPPO_DELIVERED` — delivered
- `SHIPPO_FAILURE` — delivery failed
- `SHIPPO_RETURNED` — returned to sender

Pass `carrier=shippo` when tracking test numbers.

## Troubleshooting

| Issue                          | Likely Cause                            |
|--------------------------------|------------------------------------------|
| `{"error":"..."}` from /rates  | Missing/unconfigured origin address      |
| Label purchase fails           | Rate ID is expired (>7 days old)         |
| Tracking returns error         | Wrong carrier token for tracking number  |
| No carriers available          | No carriers connected in Shippo dashboard |
