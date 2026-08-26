import { randomUUID } from 'node:crypto'
import { HttpError } from './http'
import { imageContainer } from './storage'

const allowedTypes = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])
const maximumBytes = 8 * 1024 * 1024

export async function uploadImage(file: File) {
  const extension = allowedTypes.get(file.type)
  if (!extension || file.size === 0 || file.size > maximumBytes) throw new HttpError(400, 'Photos must be JPEG, PNG, or WebP files no larger than 8 MB.')
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!hasValidSignature(bytes, file.type)) throw new HttpError(400, 'The photo contents do not match its file type.')
  const blobName = `${randomUUID()}.${extension}`
  await imageContainer().getBlockBlobClient(blobName).uploadData(bytes, { blobHTTPHeaders: { blobContentType: file.type, blobCacheControl: 'public, max-age=31536000, immutable' } })
  return blobName
}

export async function deleteImage(blobName?: string) {
  if (blobName) await imageContainer().deleteBlob(blobName, { deleteSnapshots: 'include' })
}

export async function downloadImage(blobName: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(blobName)) throw new HttpError(404, 'Image not found.')
  const blob = imageContainer().getBlobClient(blobName)
  try {
    const properties = await blob.getProperties()
    const body = await blob.downloadToBuffer()
    return { body, contentType: properties.contentType ?? 'application/octet-stream', cacheControl: properties.cacheControl ?? 'public, max-age=3600' }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404) throw new HttpError(404, 'Image not found.')
    throw error
  }
}

function hasValidSignature(bytes: Buffer, type: string) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
}