import Stripe from "stripe"

let _stripe: Stripe | null = null
let _currentKey: string | null = null

function getEnvKey(): string {
  return process.env.STRIPE_SECRET_KEY || ""
}

export function getStripe(): Stripe {
  const envKey = getEnvKey()
  if (!_stripe || _currentKey !== envKey) {
    _stripe = new Stripe(envKey, { typescript: true })
    _currentKey = envKey
  }
  return _stripe
}

export function initPlatformStripe(key: string): Stripe {
  _stripe = new Stripe(key, { typescript: true })
  _currentKey = key
  return _stripe
}

export function getStripeWithKey(key: string): Stripe {
  return new Stripe(key, { typescript: true })
}

export function formatPrice(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100)
}
