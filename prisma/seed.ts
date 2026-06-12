import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/client"
import { hashSync } from "bcryptjs"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const adminEmail = "admin@whatever.com"
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } })

  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: "Admin",
        passwordHash: hashSync("admin123", 10),
        role: "ADMIN",
      },
    })
    console.log("Admin criado: admin@whatever.com / admin123")
  }

  const products = [
    { name: "Camiseta Preta", description: "Camiseta 100% algodão", price: 5990, category: "Vestuário", inventory: 50 },
    { name: "Tênis Esportivo", description: "Tênis confortável para corrida", price: 29990, category: "Calçados", inventory: 30 },
    { name: "Mochila Executiva", description: "Mochila para notebook 15\"", price: 14990, category: "Acessórios", inventory: 20 },
    { name: "Fone Bluetooth", description: "Fone sem fio com cancelamento de ruído", price: 19990, category: "Eletrônicos", inventory: 40 },
    { name: "Caneca Personalizada", description: "Caneca de cerâmica 300ml", price: 2990, category: "Casa", inventory: 100 },
    { name: "Livro: JavaScript Moderno", description: "Guia completo de JS", price: 7990, category: "Livros", inventory: 25 },
  ]

  for (const product of products) {
    const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    const existing = await prisma.product.findUnique({ where: { slug } })
    if (!existing) {
      await prisma.product.create({ data: { ...product, slug } })
    }
  }

  console.log("Produtos seed criados!")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
