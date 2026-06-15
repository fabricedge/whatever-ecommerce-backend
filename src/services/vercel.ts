const STOREFRONT_URL = process.env.PUBLIC_STORE_URL || "https://stfront.fskk.site"

export function generateToken(digits: number = 6): string {
  const min = Math.pow(10, digits - 1)
  const max = Math.pow(10, digits) - 1
  return String(Math.floor(min + Math.random() * (max - min + 1)))
}

export async function deployStorefront(
  _storeId: string,
  slug: string,
  _enableToken: boolean = false
): Promise<{ url: string; rawToken?: string }> {
  let rawToken: string | undefined
  if (_enableToken) {
    rawToken = generateToken(6)
  }
  return {
    url: `https://${slug}.fskk.site`,
    rawToken,
  }
}
