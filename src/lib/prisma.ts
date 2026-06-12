import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

let prismaInstance: PrismaClient | null = null

function getPrisma() {
  if (prismaInstance) return prismaInstance
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required")
  const adapter = new PrismaPg(url)
  prismaInstance = new PrismaClient({ adapter })
  return prismaInstance
}

export { getPrisma }
