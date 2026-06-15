const CF_API = "https://api.cloudflare.com/client/v4"

function token() {
  return process.env.CLOUDFLARE_API_TOKEN || ""
}

function zoneId() {
  return process.env.CLOUDFLARE_ZONE_ID || ""
}

export interface DnsRecordResult {
  id: string
  name: string
  type: string
  content: string
}

export async function createDnsRecord(subdomain: string): Promise<DnsRecordResult> {
  const res = await fetch(`${CF_API}/zones/${zoneId()}/dns_records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "A",
      name: subdomain,
      content: "76.76.21.21",
      proxied: false,
      ttl: 120,
    }),
  })

  const json: any = await res.json()
  if (!json.success) {
    const err = json.errors?.[0]?.message || JSON.stringify(json.errors)
    throw new Error(`Cloudflare DNS creation failed: ${err}`)
  }

  return json.result as DnsRecordResult
}

export async function deleteDnsRecord(recordId: string): Promise<void> {
  const res = await fetch(`${CF_API}/zones/${zoneId()}/dns_records/${recordId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token()}` },
  })

  const json: any = await res.json()
  if (!json.success) {
    const err = json.errors?.[0]?.message || JSON.stringify(json.errors)
    throw new Error(`Cloudflare DNS deletion failed: ${err}`)
  }
}
