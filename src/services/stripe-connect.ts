import { getStripe } from "../lib/stripe.js"

const PLATFORM_FEE_PERCENT = 0.02
const PLATFORM_FEE_FIXED = 50

export function calculateApplicationFee(amountCents: number): number {
  return Math.round(amountCents * PLATFORM_FEE_PERCENT) + PLATFORM_FEE_FIXED
}

export async function createConnectedAccount(storeName: string, email: string, url: string) {
  const stripe = getStripe()
  const account = await stripe.accounts.create({
    country: "BR",
    type: "express",
    email,
    business_type: "individual",
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    business_profile: {
      mcc: "5734",
      url,
      name: storeName,
    },
  })
  return account
}

export async function createAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
  const stripe = getStripe()
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: refreshUrl,
    return_url: returnUrl,
  })
  return accountLink
}

export async function retrieveAccount(accountId: string) {
  const stripe = getStripe()
  return stripe.accounts.retrieve(accountId)
}
