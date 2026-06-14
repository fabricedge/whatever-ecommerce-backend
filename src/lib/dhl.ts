const DHL_API_URL = process.env.DHL_API_URL || 'https://express.api.dhl.com/mydhlapi/test'
const DHL_API_KEY = process.env.DHL_API_KEY || ''
const DHL_API_SECRET = process.env.DHL_API_SECRET || ''
const DHL_ACCOUNT = process.env.DHL_SHIPPER_ACCOUNT_NUMBER || ''

function authHeader(): string {
  return 'Basic ' + btoa(`${DHL_API_KEY}:${DHL_API_SECRET}`)
}

interface DHLRateRequest {
  originCountryCode: string
  originPostalCode: string
  destinationCountryCode: string
  destinationPostalCode: string
  weight: number
  length: number
  width: number
  height: number
  declaredValue: number
  declaredCurrency: string
}

interface DHLRate {
  productCode: string
  productName: string
  totalPrice: number
  currency: string
  estimatedDeliveryDate: string
  deliveryType: string
}

interface DHLRateResponse {
  products: DHLRate[]
  error?: string
}

interface DHLAddress {
  postalCode: string
  city: string
  countryCode: string
  addressLine1: string
  addressLine2?: string
  name: string
  phone: string
  email: string
}

interface DHLPackage {
  weight: number
  length: number
  width: number
  height: number
}

interface DHLShipmentRequest {
  shipper: DHLAddress
  receiver: DHLAddress
  packages: DHLPackage[]
  productCode: string
  declaredValue: number
  declaredCurrency: string
  unitOfMeasurement: 'metric'
  content: string
  orderReference: string
}

interface DHLShipmentResponse {
  shipmentTrackingNumber: string
  trackingUrl: string
  labelB64: string
  labelFormat: string
  dispatchConfirmationNumber: string
  error?: string
}

interface DHLTrackingEvent {
  timestamp: string
  location: string
  status: string
  description: string
}

interface DHLTrackingResponse {
  shipmentTrackingNumber: string
  status: string
  estimatedDeliveryDate: string
  events: DHLTrackingEvent[]
  error?: string
}

export async function getRates(req: DHLRateRequest): Promise<DHLRateResponse> {
  const { originCountryCode, originPostalCode, destinationCountryCode, destinationPostalCode, weight, length, width, height, declaredValue, declaredCurrency } = req

  const body = {
    customerDetails: {
      shipperDetails: {
        postalCode: originPostalCode,
        countryCode: originCountryCode,
      },
      receiverDetails: {
        postalCode: destinationPostalCode,
        countryCode: destinationCountryCode,
      },
    },
    accounts: [{
      number: DHL_ACCOUNT,
      typeCode: 'shipper',
    }],
    plannedShippingDateAndTime: new Date(Date.now() + 86400000).toISOString(),
    unitOfMeasurement: 'metric',
    isCustomsDeclarable: false,
    packages: [{
      weight: weight,
      dimensions: {
        length: length,
        width: width,
        height: height,
      },
    }],
    declaredValue: declaredValue,
    declaredValueCurrency: declaredCurrency,
  }

  try {
    const res = await fetch(`${DHL_API_URL}/rates`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      return { products: [], error: data.detail || data.message || `DHL error: ${res.status}` }
    }

    const products: DHLRate[] = (data.products || []).map((p: any) => ({
      productCode: p.productCode,
      productName: p.productName,
      totalPrice: p.totalPrice?.[0]?.price || 0,
      currency: p.totalPrice?.[0]?.priceCurrency || 'BRL',
      estimatedDeliveryDate: p.deliveryCapabilities?.estimatedDeliveryDate || '',
      deliveryType: p.deliveryType || '',
    }))

    return { products }
  } catch (err: any) {
    return { products: [], error: err.message }
  }
}

export async function createShipment(req: DHLShipmentRequest): Promise<DHLShipmentResponse> {
  const { shipper, receiver, packages, productCode, declaredValue, declaredCurrency, content, orderReference } = req

  const body: any = {
    plannedShippingDateAndTime: new Date(Date.now() + 86400000).toISOString(),
    pickUp: {
      isRequested: false,
    },
    productCode,
    accounts: [{
      number: DHL_ACCOUNT,
      typeCode: 'shipper',
    }],
    customerDetails: {
      shipperDetails: {
        postalCode: shipper.postalCode,
        cityName: shipper.city,
        countryCode: shipper.countryCode,
        addressLine1: shipper.addressLine1,
        addressLine2: shipper.addressLine2,
        shipperName: shipper.name,
        shipperPhone: shipper.phone,
        shipperEmail: shipper.email,
      },
      receiverDetails: {
        postalCode: receiver.postalCode,
        cityName: receiver.city,
        countryCode: receiver.countryCode,
        addressLine1: receiver.addressLine1,
        addressLine2: receiver.addressLine2,
        receiverName: receiver.name,
        receiverPhone: receiver.phone,
        receiverEmail: receiver.email,
      },
    },
    content: {
      description: content,
      isCustomsDeclarable: false,
      declaredValue,
      declaredValueCurrency: declaredCurrency,
    },
    outputImageProperties: {
      imageOptions: [{
        templateName: 'TRANSPORT_LABEL_PDF',
        requestedEncoding: 'base64',
      }],
    },
    customerReferences: [{
      value: orderReference,
      typeCode: 'CU',
    }],
    shipmentNotification: [{
      typeCode: 'EMAIL',
      receiverEmail: receiver.email,
    }],
    packages: packages.map((pkg, i) => ({
      weight: pkg.weight,
      dimensions: {
        length: pkg.length,
        width: pkg.width,
        height: pkg.height,
      },
      customerReferences: [{
        value: `${orderReference}-${i + 1}`,
        typeCode: 'CU',
      }],
    })),
  }

  try {
    const res = await fetch(`${DHL_API_URL}/shipments`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        shipmentTrackingNumber: '',
        trackingUrl: '',
        labelB64: '',
        labelFormat: '',
        dispatchConfirmationNumber: '',
        error: data.detail || data.message || `DHL error: ${res.status}`,
      }
    }

    const labelImage = data.documents?.[0]?.content || ''
    const trackingNumber = data.shipmentTrackingNumber || data.packages?.[0]?.references?.[0]?.value || ''

    return {
      shipmentTrackingNumber: trackingNumber,
      trackingUrl: `https://www.dhl.com/br-pt/home/rastreamento.html?tracking-id=${trackingNumber}`,
      labelB64: labelImage,
      labelFormat: 'pdf',
      dispatchConfirmationNumber: data.dispatchConfirmationNumber || '',
    }
  } catch (err: any) {
    return {
      shipmentTrackingNumber: '',
      trackingUrl: '',
      labelB64: '',
      labelFormat: '',
      dispatchConfirmationNumber: '',
      error: err.message,
    }
  }
}

export async function trackShipment(trackingNumber: string): Promise<DHLTrackingResponse> {
  try {
    const res = await fetch(`${DHL_API_URL}/tracking?shipmentTrackingNumber=${trackingNumber}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader(),
        'Content-Type': 'application/json',
      },
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        shipmentTrackingNumber: trackingNumber,
        status: 'error',
        estimatedDeliveryDate: '',
        events: [],
        error: data.detail || data.message || `DHL error: ${res.status}`,
      }
    }

    const shipments = data.shipments || []
    const shipment = shipments[0] || {}

    return {
      shipmentTrackingNumber: trackingNumber,
      status: shipment.status?.statusCode || 'unknown',
      estimatedDeliveryDate: shipment.estimatedDeliveryDate || '',
      events: (shipment.events || []).map((e: any) => ({
        timestamp: e.timestamp || e.date || '',
        location: e.location?.address?.addressLocality || '',
        status: e.statusCode || '',
        description: e.description || '',
      })),
    }
  } catch (err: any) {
    return {
      shipmentTrackingNumber: trackingNumber,
      status: 'error',
      estimatedDeliveryDate: '',
      events: [],
      error: err.message,
    }
  }
}

export function isDHLConfigured(): boolean {
  return !!(DHL_API_KEY && DHL_API_SECRET && DHL_ACCOUNT)
}
