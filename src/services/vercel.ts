const VERCEL_API = "https://api.vercel.com"
const VERCEL_TOKEN = () => process.env.VERCEL_TOKEN || ""
const VERCEL_TEAM = () => process.env.VERCEL_TEAM_ID || ""
const STOREFRONT_PROJECT = () => process.env.VERCEL_STOREFRONT_PROJECT || "whatever-ecommerce-storefront-svelte"
const PUBLIC_STORE_URL = () => process.env.PUBLIC_STORE_URL || "https://stfront.fskk.site"

export function generateToken(digits: number = 6): string {
  const min = Math.pow(10, digits - 1)
  const max = Math.pow(10, digits) - 1
  return String(Math.floor(min + Math.random() * (max - min + 1)))
}

async function vercelFetch(path: string, options: RequestInit = {}) {
  const teamParam = VERCEL_TEAM() ? `?teamId=${VERCEL_TEAM()}` : ""
  const url = `${VERCEL_API}${path}${path.includes("?") ? "&" : "?"}teamId=${VERCEL_TEAM()}`
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })
  const body = await res.json()
  if (!res.ok) {
    const msg = body.error?.message || res.statusText
    throw new Error(`Vercel API error: ${msg}`)
  }
  return body
}

export async function deployStorefront(
  storeId: string,
  slug: string,
  enableToken: boolean = false,
  customDomain?: string
): Promise<{ url: string; rawToken?: string; status: 'DEPLOYING' | 'READY' | 'FAILED'; error?: string }> {
  let rawToken: string | undefined
  if (enableToken) {
    rawToken = generateToken(6)
  }

  const domain = `${slug}.fskk.site`

  // Get project info to find the storefront project ID
  let project: any
  try {
    const projects = await vercelFetch("/v9/projects")
    project = projects.projects?.find((p: any) => p.name === STOREFRONT_PROJECT())
    if (!project) {
      const alt = await vercelFetch(`/v9/projects/${STOREFRONT_PROJECT()}`)
      project = alt
    }
  } catch (err: any) {
    console.error(`[deployStorefront] failed to find project ${STOREFRONT_PROJECT()}:`, err.message)
    return { url: `https://${domain}`, rawToken, status: 'FAILED', error: `Vercel project not found: ${err.message}` }
  }

  const projectId = project.id || project.projectId
  if (!projectId) {
    console.error(`[deployStorefront] no project id for ${STOREFRONT_PROJECT()}`)
    return { url: `https://${domain}`, rawToken, status: 'FAILED', error: 'Vercel project ID not found' }
  }

  // Add domain alias to the storefront project
  try {
    await vercelFetch(`/v9/projects/${projectId}/domains`, {
      method: "POST",
      body: JSON.stringify({ name: domain }),
    })
    console.log(`[deployStorefront] domain ${domain} added to project ${STOREFRONT_PROJECT()}`)
  } catch (err: any) {
    // If already exists, that's fine
    if (!err.message?.includes("already exists")) {
      console.error(`[deployStorefront] failed to add domain ${domain}:`, err.message)
    }
  }

  // Add custom domain alias if provided
  if (customDomain) {
    try {
      await vercelFetch(`/v9/projects/${projectId}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: customDomain }),
      })
      console.log(`[deployStorefront] custom domain ${customDomain} added to project ${STOREFRONT_PROJECT()}`)
    } catch (err: any) {
      if (!err.message?.includes("already exists")) {
        console.error(`[deployStorefront] failed to add custom domain ${customDomain}:`, err.message)
      }
    }
  }

  // Trigger a production deployment so the new domain aliases take effect
  try {
    const latestDeployments = await vercelFetch(`/v6/deployments?projectId=${projectId}&target=production&limit=1&rollback=0`)
    const latestDeploy = latestDeployments.deployments?.[0]
    if (latestDeploy?.uid) {
      await vercelFetch(`/v1/deployments`, {
        method: "POST",
        body: JSON.stringify({ projectId, deploymentId: latestDeploy.uid, target: "production", meta: { trigger: "store-activation" } }),
      })
      console.log(`[deployStorefront] deployment triggered from ${latestDeploy.uid}`)
    } else {
      console.warn(`[deployStorefront] no previous deployment found to redeploy`)
    }
  } catch (err: any) {
    console.error(`[deployStorefront] failed to trigger deployment:`, err.message)
  }

  return {
    url: `https://${customDomain || domain}`,
    rawToken,
    status: 'DEPLOYING',
  }
}