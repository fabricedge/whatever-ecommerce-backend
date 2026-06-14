import { v2 as cloudinary } from 'cloudinary'

let configured = false

function ensureConfig() {
  if (configured) return
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
    api_key: process.env.CLOUDINARY_API_KEY!,
    api_secret: process.env.CLOUDINARY_API_SECRET!,
  })
  configured = true
}

export type UploadResult = {
  publicId: string
  url: string
  width: number
  height: number
  format: string
  bytes: number
}

export async function uploadFromBuffer(
  buffer: Buffer,
  mimeType: string,
  folder?: string
): Promise<UploadResult> {
  ensureConfig()
  const b64 = buffer.toString('base64')
  const result = await cloudinary.uploader.upload(`data:${mimeType};base64,${b64}`, {
    folder: folder || 'products',
  })
  return {
    publicId: result.public_id,
    url: result.secure_url,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes,
  }
}

export async function deleteImage(publicId: string) {
  ensureConfig()
  return cloudinary.uploader.destroy(publicId)
}

export function getOptimizedUrl(publicId: string): string {
  ensureConfig()
  return cloudinary.url(publicId, { f_auto: 'auto', q_auto: 'auto' })
}

export { cloudinary }
