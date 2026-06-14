import { v2 as cloudinary } from "cloudinary"

cloudinary.config({
  cloud_name: "dlcui5ugt",
  api_key: "179925792629985",
  api_secret: "pF39YCOOPye8AplpZsCt5dvudp0",
})

const products = [
  { name: "Camiseta Preta", url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600" },
  { name: "Tênis Esportivo", url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600" },
  { name: "Mochila Executiva", url: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600" },
  { name: "Fone Bluetooth", url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600" },
  { name: "Caneca Personalizada", url: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=600" },
  { name: "Livro: JavaScript Moderno", url: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600" },
]

for (const p of products) {
  try {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    const result = await cloudinary.uploader.upload(p.url, { folder: "products", public_id: slug })
    console.log(`${p.name}: ${result.secure_url}`)
  } catch (err) {
    console.error(`${p.name}: FAILED - ${err.message}`)
  }
}
