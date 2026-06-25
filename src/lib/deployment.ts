const PUBLIC_STORE_URL = process.env.PUBLIC_STORE_URL || 'https://stfront.fskk.site'

export async function checkDeployment(url: string): Promise<'READY' | 'FAILED'> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    })
    return res.ok ? 'READY' : 'FAILED'
  } catch {
    return 'FAILED'
  }
}

export function buildStoreUrl(slug: string): string {
  return `https://${slug}.fskk.site`
}
