import { Hono } from 'hono'
import { getPrisma } from '../lib/prisma.js'
import { authMiddleware, adminMiddleware } from '../lib/auth-middleware.js'
import { uploadFromBuffer, deleteImage } from '../lib/cloudinary.js'

const upload = new Hono()

upload.post('/', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'Arquivo não enviado' }, 400)
  }

  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) {
    return c.json({ error: `Formato não suportado: ${file.type}` }, 400)
  }

  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: 'Arquivo muito grande. Máximo: 10MB' }, 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await uploadFromBuffer(buffer, file.type)

  const image = await getPrisma().image.create({
    data: {
      publicId: result.publicId,
      url: result.url,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    },
  })

  return c.json(image, 201)
})

upload.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id')
  const image = await getPrisma().image.findUnique({ where: { id } })
  if (!image) return c.json({ error: 'Imagem não encontrada' }, 404)

  await deleteImage(image.publicId)
  await getPrisma().image.delete({ where: { id } })

  return c.json({ success: true })
})

export default upload
