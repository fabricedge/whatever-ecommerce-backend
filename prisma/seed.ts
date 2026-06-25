import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { hashSync } from "bcryptjs"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const adminEmail = "admin@whatever.com"
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } })

  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: "Admin",
        passwordHash: hashSync("admin123", 10),
        role: "SUPER_ADMIN",
      },
    })
    console.log("SUPER_ADMIN criado: admin@whatever.com / admin123")
  } else if (admin.role !== "SUPER_ADMIN") {
    admin = await prisma.user.update({
      where: { email: adminEmail },
      data: { role: "SUPER_ADMIN" },
    })
    console.log("Admin atualizado para SUPER_ADMIN")
  }

  let defaultStore = await prisma.store.findFirst({ where: { slug: "minha-loja" } })
  if (!defaultStore) {
    defaultStore = await prisma.store.create({
      data: {
        name: "Minha Loja",
        slug: "minha-loja",
        plan: "FREE",
      },
    })
    console.log("Loja padrão criada: Minha Loja")
  }

  let globalStore = await prisma.store.findUnique({ where: { id: "global" } })
  if (!globalStore) {
    globalStore = await prisma.store.create({
      data: { id: "global", name: "Global", slug: "global" },
    })
    console.log("Loja global criada para configurações do sistema")
  }

  const existingMembership = await prisma.userStore.findUnique({
    where: { userId_storeId: { userId: admin.id, storeId: defaultStore.id } },
  })
  if (!existingMembership) {
    await prisma.userStore.create({
      data: { userId: admin.id, storeId: defaultStore.id },
    })
    console.log("Admin associado como OWNER da loja padrão")
  }

  const products = [
    { name: "Camiseta Preta", description: "Camiseta 100% algodão", price: 5990, category: "Vestuário", inventory: 50, images: ["https://res.cloudinary.com/dlcui5ugt/image/upload/v1781437184/products/camiseta-preta.jpg"] },
    { name: "Tênis Esportivo", description: "Tênis confortável para corrida", price: 29990, category: "Calçados", inventory: 30, images: ["https://res.cloudinary.com/dlcui5ugt/image/upload/v1781437185/products/t-nis-esportivo.jpg"] },
    { name: "Mochila Executiva", description: "Mochila para notebook 15\"", price: 14990, category: "Acessórios", inventory: 20, images: ["https://res.cloudinary.com/dlcui5ugt/image/upload/v1781437185/products/mochila-executiva.jpg"] },
    { name: "Fone Bluetooth", description: "Fone sem fio com cancelamento de ruído", price: 19990, category: "Eletrônicos", inventory: 40, images: ["https://res.cloudinary.com/dlcui5ugt/image/upload/v1781437186/products/fone-bluetooth.jpg"] },
    { name: "Caneca Personalizada", description: "Caneca de cerâmica 300ml", price: 2990, category: "Casa", inventory: 100, images: ["https://res.cloudinary.com/dlcui5ugt/image/upload/v1781437186/products/caneca-personalizada.jpg"] },
    { name: "Livro: JavaScript Moderno", description: "Guia completo de JS", price: 7990, category: "Livros", inventory: 25, images: ["https://res.cloudinary.com/dlcui5ugt/image/upload/v1781437187/products/livro-javascript-moderno.jpg"] },
  ]

  for (const product of products) {
    const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    const existing = await prisma.product.findUnique({ where: { slug } })
    if (!existing) {
      await prisma.product.create({ data: { ...product, slug, storeId: defaultStore.id } })
    } else if (!existing.storeId) {
      await prisma.product.update({
        where: { id: existing.id },
        data: { storeId: defaultStore.id },
      })
    }
  }

  // Backfill any orders without storeId
  await prisma.order.updateMany({
    where: { storeId: { equals: undefined } },
    data: { storeId: defaultStore.id },
  })

  // Backfill any settings without storeId
  const orphanSettings = await prisma.setting.findMany({ where: { storeId: { equals: undefined } } } as any)
  for (const s of orphanSettings) {
    await prisma.setting.delete({ where: { storeId_key: { storeId: s.storeId, key: s.key } } } as any)
  }

  console.log("Seed concluído!")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
