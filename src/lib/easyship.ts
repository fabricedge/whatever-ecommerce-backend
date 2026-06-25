import { getPrisma } from './prisma.js'

const EASYSHIP_API_URL = (process.env.EASYSHIP_API_URL || 'https://api.easyship.com').replace(/\/+$/, '')
const GLOBAL_CLIENT_ID = process.env.EASYSHIP_CLIENT_ID || ''
const GLOBAL_CLIENT_SECRET = process.env.EASYSHIP_CLIENT_SECRET || ''

type TokenEntry = { accessToken: string; expiresAt: number }
const tokenCache = new Map<string, TokenEntry>()

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

async function getCredentials(storeId?: string) {
  if (storeId) {
    try {
      const settings = await getPrisma().setting.findMany({
        where: {
          storeId,
          key: { in: ['easyship_client_id', 'easyship_client_secret'] },
        },
      })
      const map: Record<string, string> = {}
      for (const s of settings) map[s.key] = s.value
      if (map.easyship_client_id && map.easyship_client_secret) {
        return {
          clientId: map.easyship_client_id,
          clientSecret: map.easyship_client_secret,
        }
      }
    } catch {
      // DB unavailable — fall through to global
    }
  }
  return { clientId: GLOBAL_CLIENT_ID, clientSecret: GLOBAL_CLIENT_SECRET }
}

export async function isConfigured(storeId?: string): Promise<boolean> {
  const creds = await getCredentials(storeId)
  return !!creds.clientId && !!creds.clientSecret
}

export async function hasOwnCredentials(storeId: string): Promise<boolean> {
  if (!storeId) return false
  try {
    const settings = await getPrisma().setting.findMany({
      where: {
        storeId,
        key: { in: ['easyship_client_id', 'easyship_client_secret'] },
      },
    })
    const map: Record<string, string> = {}
    for (const s of settings) map[s.key] = s.value
    return !!map.easyship_client_id && !!map.easyship_client_secret
  } catch {
    return false
  }
}

function cacheKey(storeId?: string): string {
  return storeId || '_global_'
}

async function getAccessToken(storeId?: string): Promise<string> {
  const key = cacheKey(storeId)
  const cached = tokenCache.get(key)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken
  }

  const creds = await getCredentials(storeId)

  const res = await fetch(`${EASYSHIP_API_URL}/oauth/token`, {
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
  storeId?: string,
): Promise<any> {
  const token = await getAccessToken(storeId)
  const url = `${EASYSHIP_API_URL}${path}`
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
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    street: addr.street1,
    contact_name: addr.name,
    company_name: addr.company || undefined,
    phone: addr.phone || undefined,
    email: addr.email || undefined,
  }
}

export async function getRates(
  addressFrom: EasyshipAddressInput,
  addressTo: EasyshipAddressInput,
  parcel: EasyshipParcelInput,
  storeId?: string,
): Promise<{ rates: EasyshipRate[]; error?: string }> {
  try {
    const response = await easyshipFetch(
      '/2024-09/rates',
      {
        method: 'POST',
        body: JSON.stringify({
          origin_address: toEasyshipAddress(addressFrom),
          destination_address: toEasyshipAddress(addressTo),
          parcels: [
            {
              box: {
                length: parcel.length,
                width: parcel.width,
                height: parcel.height,
                weight: parcel.weight,
              },
            },
          ],
        }),
      },
      storeId,
    )

    const rates: EasyshipRate[] = (response.rates || []).map((r: any) => ({
      courierServiceId: r.courier_service?.id || '',
      provider:
        r.courier_service?.umbrella_name || r.courier_service?.name || '',
      serviceLevelName: r.courier_service?.name || '',
      serviceLevelToken: '',
      amount: (r.total_charge || r.shipment_charge_total || 0) / 100,
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
  items?: {
    description: string
    quantity: number
    price: number
    currency: string
  }[],
  storeId?: string,
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

export async function trackShipment(
  shipmentId: string,
  storeId?: string,
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
