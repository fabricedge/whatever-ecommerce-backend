import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaNeonHttp } from "@prisma/adapter-neon"
import { PrismaClient } from "@prisma/client"

let prismaInstance: PrismaClient | null = null

function getPrisma() {
  if (prismaInstance) return prismaInstance
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required")

  const useNeon = process.env.VERCEL || url.includes("neon.tech")
  const adapter = useNeon
    ? new PrismaNeonHttp(url, {})
    : new PrismaPg({ connectionString: url })

  prismaInstance = new PrismaClient({ adapter })
  return prismaInstance
}

export { getPrisma }
