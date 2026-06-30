import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaNeon } from "@prisma/adapter-neon"
import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")

const useNeon = process.env.VERCEL || url.includes("neon.tech")
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
const adapter = useNeon
  ? new (PrismaNeon as any)({ connectionString: url })
  : new PrismaPg({ connectionString: url })

const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const stores = await prisma.store.findMany({ select: { id: true } })

  for (const store of stores) {
    const products = await prisma.product.findMany({
      where: { storeId: store.id, category: { not: null } },
      select: { id: true, category: true },
    })

    const categoryNames = [...new Set(products.map(p => p.category).filter(Boolean))] as string[]

    for (const name of categoryNames) {
      const existing = await prisma.category.findUnique({
        where: { name_storeId: { name, storeId: store.id } },
      })

      let cat = existing
      if (!cat) {
        cat = await prisma.category.create({
          data: { name, storeId: store.id },
        })
      }

      await prisma.product.updateMany({
        where: { storeId: store.id, category: name },
        data: { categoryId: cat.id },
      })
    }

    if (categoryNames.length > 0) {
      console.log(`Store ${store.id}: migrated ${categoryNames.length} categories (${categoryNames.join(', ')})`)
    }
  }

  console.log('Migration complete')
}

main().catch(console.error).finally(() => prisma.$disconnect())
