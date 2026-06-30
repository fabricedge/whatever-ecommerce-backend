import { getPrisma } from './prisma.js'
import { decrypt } from './encryption.js'

// ATENÇÃO: EasyShip atualmente configurado apenas para rotas domésticas nos EUA.
// Para suporte Brasil (BR-BR), é necessário:
//   1. Token de produção EasyShip (prefixo prod_) com rotas BR ativadas
//   2. Trocar defaults "US" para "BR" em: shipping.ts, cart/+page.svelte, checkout-session.ts
//   3. Atualizar origin_country e CEP de origem nas settings do admin

const EASYSHIP_OAUTH_URL = 'https://enterprise-api.easyship.com/oauth2/token'

type TokenEntry = { accessToken: string; expiresAt: number }
const tokenCache = new Map<string, TokenEntry>()

type Credentials =
  | { apiToken: string }
  | { clientId: string; clientSecret: string }

export interface EasyshipAddressInput {
  name: string
  company?: string
  street1: string
  street2?: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
  email?: string
}

export interface EasyshipParcelInput {
  length: number
  width: number
  height: number
  distanceUnit: 'cm' | 'in'
  weight: number
  massUnit: 'kg' | 'lb'
}

export interface EasyshipRateItem {
  actualWeight: number
  category?: string
  hsCode?: string
  declaredCurrency: string
  declaredCustomsValue: number
}

export interface EasyshipRate {
  courierServiceId: string
  provider: string
  serviceLevelName: string
  serviceLevelToken: string
  amount: number
  currency: string
  estimatedDays: string
}

export interface EasyshipLabelResult {
  trackingNumber: string
  labelUrl: string
  carrier: string
  serviceLevel: string
  trackingUrlProvider: string
  easyshipShipmentId: string
  error?: string
}

export interface EasyshipTrackingEvent {
  timestamp: string
  location: string
  status: string
  description: string
}

export interface EasyshipTrackingResult {
  trackingNumber: string
  status: string
  estimatedDeliveryDate: string
  events: EasyshipTrackingEvent[]
  error?: string
}

function getPublicApiUrl(tokenHint?: string): string {
  if (tokenHint?.startsWith('sand_')) return 'https://public-api-sandbox.easyship.com'
  const envUrl = process.env.EASYSHIP_API_URL
  if (envUrl) return envUrl.replace(/\/+$/, '')
  return 'https://public-api.easyship.com'
}

async function getCredentials(storeId: string): Promise<Credentials> {
  const settings = await getPrisma().setting.findMany({
    where: {
      storeId,
      key: { in: ['easyship_client_id', 'easyship_client_secret', 'easyship_api_token'] },
    },
  })
  const map: Record<string, string> = {}
  for (const s of settings) map[s.key] = s.value

  if (map.easyship_api_token) {
    return { apiToken: decrypt(map.easyship_api_token) }
  }

  if (map.easyship_client_id && map.easyship_client_secret) {
    return {
      clientId: decrypt(map.easyship_client_id),
      clientSecret: decrypt(map.easyship_client_secret),
    }
  }

  throw new Error('EasyShip não configurado para esta loja. Configure easyship_api_token ou easyship_client_id + easyship_client_secret em Configurações.')
}

export async function isConfigured(storeId: string): Promise<boolean> {
  try {
    const creds = await getCredentials(storeId)
    return 'apiToken' in creds
      ? !!creds.apiToken
      : !!creds.clientId && !!creds.clientSecret
  } catch {
    return false
  }
}

export async function hasOwnCredentials(storeId: string): Promise<boolean> {
  return isConfigured(storeId)
}

async function getAccessToken(storeId: string): Promise<string> {
  const creds = await getCredentials(storeId)

  if ('apiToken' in creds) {
    return creds.apiToken
  }

  const key = storeId
  const cached = tokenCache.get(key)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken
  }

  const res = await fetch(EASYSHIP_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'client_credentials',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Easyship OAuth failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    expires_in: number
  }
  const entry: TokenEntry = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }
  tokenCache.set(key, entry)
  return entry.accessToken
}

async function easyshipFetch(
  path: string,
  options: RequestInit = {},
  storeId: string,
): Promise<any> {
  const creds = await getCredentials(storeId)
  const token = 'apiToken' in creds ? creds.apiToken : await getAccessToken(storeId)
  const baseUrl = getPublicApiUrl('apiToken' in creds ? creds.apiToken : undefined)
  const url = `${baseUrl}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  if (!res.ok) {
    let errorText = ''
    try {
      const errorBody = await res.json()
      errorText = JSON.stringify(errorBody)
    } catch {
      errorText = await res.text()
    }
    throw new Error(`Easyship API ${res.status}: ${errorText}`)
  }

  return res.json()
}

function toEasyshipAddress(addr: EasyshipAddressInput) {
  return {
    country_alpha2: addr.country,
    city: addr.city || "Destino",
    state: addr.state || undefined,
    postal_code: addr.zip,
    street: addr.street1 || undefined,
    contact_name: addr.name || undefined,
    company_name: addr.company || undefined,
    phone: addr.phone || undefined,
    email: addr.email || undefined,
  }
}

export async function getRates(
  addressFrom: EasyshipAddressInput,
  addressTo: EasyshipAddressInput,
  parcel: EasyshipParcelInput,
  storeId: string,
  items?: EasyshipRateItem[],
): Promise<{ rates: EasyshipRate[]; error?: string }> {
  try {
    const rateItems = items && items.length > 0
      ? items
      : [{
          actualWeight: parcel.weight,
          hsCode: '847130',
          declaredCurrency: 'USD',
          declaredCustomsValue: 5000,
        }]

    const rawBody = {
      origin_address: toEasyshipAddress(addressFrom),
      destination_address: toEasyshipAddress(addressTo),
      parcels: [
        {
          total_actual_weight: parcel.weight,
          box: {
            length: parcel.length,
            width: parcel.width,
            height: parcel.height,
          },
          items: rateItems.map((i) => ({
            actual_weight: i.actualWeight,
            ...(i.hsCode ? { hs_code: i.hsCode } : {}),
            ...(i.category ? { category: i.category } : {}),
            declared_currency: i.declaredCurrency,
            declared_customs_value: i.declaredCustomsValue,
          })),
        },
      ],
    }
    const body = JSON.stringify(rawBody)
    const response = await easyshipFetch(
      '/2024-09/rates',
      {
        method: 'POST',
        body,
      },
      storeId,
    )

    const rates: EasyshipRate[] = (response.rates || []).map((r: any) => ({
      courierServiceId: r.courier_service?.id || '',
      provider:
        r.courier_service?.umbrella_name || r.courier_service?.name || '',
      serviceLevelName: r.courier_service?.name || '',
      serviceLevelToken: '',
      amount: (r.total_charge || r.shipment_charge_total || 0),
      currency: r.currency || 'USD',
      estimatedDays:
        r.min_delivery_time != null
          ? `${r.min_delivery_time}${r.max_delivery_time != null ? `-${r.max_delivery_time}` : ''}`
          : '',
    }))

    return { rates }
  } catch (err: any) {
    return { rates: [], error: err.message }
  }
}

export async function createLabel(
  origin: EasyshipAddressInput,
  destination: EasyshipAddressInput,
  parcel: EasyshipParcelInput,
  courierServiceId: string,
  storeId: string,
  items?: {
    description: string
    quantity: number
    price: number
    currency: string
  }[],
): Promise<EasyshipLabelResult> {
  try {
    const shipmentBody: any = {
      origin_address: toEasyshipAddress(origin),
      destination_address: toEasyshipAddress(destination),
      courier_service_id: courierServiceId,
      boxes: [
        {
          length: parcel.length,
          width: parcel.width,
          height: parcel.height,
          weight: parcel.weight,
        },
      ],
    }

    if (items && items.length > 0) {
      shipmentBody.items = items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        actual_weight: parcel.weight,
        price: item.price / 100,
        currency: item.currency,
        origin_country_alpha2: origin.country,
      }))
    }

    const shipment = await easyshipFetch(
      '/2024-09/shipments',
      {
        method: 'POST',
        body: JSON.stringify(shipmentBody),
      },
      storeId,
    )

    const shipmentId = shipment.id || shipment.shipment_id || ''

    const label = await easyshipFetch(
      `/2024-09/shipments/${shipmentId}/label`,
      {
        method: 'POST',
        body: JSON.stringify({
          courier_service_id: courierServiceId,
        }),
      },
      storeId,
    )

    return {
      trackingNumber: label.tracking_number || label.courier_tracking_code || '',
      labelUrl: label.label_url || '',
      carrier: label.courier_name || label.courier_id || '',
      serviceLevel: label.service_level_name || '',
      trackingUrlProvider: label.tracking_url || '',
      easyshipShipmentId: shipmentId,
    }
  } catch (err: any) {
    return {
      trackingNumber: '',
      labelUrl: '',
      carrier: '',
      serviceLevel: '',
      trackingUrlProvider: '',
      easyshipShipmentId: '',
      error: err.message,
    }
  }
}

export async function checkConnection(
  storeId: string,
): Promise<{ status: string; message: string }> {
  try {
    const creds = await getCredentials(storeId)
    const token = 'apiToken' in creds ? creds.apiToken : await getAccessToken(storeId)
    const baseUrl = getPublicApiUrl('apiToken' in creds ? creds.apiToken : undefined)
    const res = await fetch(`${baseUrl}/2024-09/account`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (res.ok) {
      return { status: 'ok', message: 'Conectado à EasyShip' }
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}))
      if (body?.error?.code === 'usage_limit') {
        return { status: 'usage_limit', message: 'Limite de uso excedido. Aguarde alguns minutos.' }
      }
      return { status: 'error', message: `HTTP ${res.status}: ${body?.error?.message || res.statusText}` }
    }
    return { status: 'error', message: `HTTP ${res.status}: ${res.statusText}` }
  } catch (err: any) {
    return { status: 'error', message: err.message }
  }
}

export async function trackShipment(
  shipmentId: string,
  storeId: string,
): Promise<EasyshipTrackingResult> {
  try {
    const response = await easyshipFetch(
      `/2024-09/shipments/${shipmentId}/tracking`,
      {},
      storeId,
    )

    return {
      trackingNumber: response.tracking_number || '',
      status: response.tracking_status || 'UNKNOWN',
      estimatedDeliveryDate: response.estimated_delivery_date || '',
      events: (response.events || []).map((e: any) => ({
        timestamp: e.occurred_at || e.timestamp || '',
        location: e.location || '',
        status: e.status || e.tracking_status || '',
        description: e.description || e.status || '',
      })),
    }
  } catch (err: any) {
    return {
      trackingNumber: '',
      status: 'error',
      estimatedDeliveryDate: '',
      events: [],
      error: err.message,
    }
  }
}
