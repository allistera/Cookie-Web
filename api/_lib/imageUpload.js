import { Buffer } from 'node:buffer'

import { put } from '@vercel/blob'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

async function parseMultipartForm(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)

  const contentType = req.headers['content-type']
  if (!contentType?.startsWith('multipart/form-data')) {
    throw new Error('Content-Type must be multipart/form-data')
  }

  const boundaryMatch = contentType.match(/boundary=([^;]+)/)
  if (!boundaryMatch) {
    throw new Error('Invalid boundary in Content-Type')
  }

  const boundary = boundaryMatch[1]
  const parts = body.toString('binary').split(`--${boundary}`)

  for (const part of parts) {
    if (!part.includes('Content-Disposition')) continue

    const headersEnd = part.indexOf('\r\n\r\n')
    if (headersEnd === -1) continue

    const headers = part.substring(0, headersEnd)
    const content = part.substring(headersEnd + 4).replace(/\r\n$/, '')
    const nameMatch = headers.match(/name="([^"]+)"/)
    const filenameMatch = headers.match(/filename="([^"]+)"/)
    const typeMatch = headers.match(/Content-Type: ([^\r\n]+)/)

    if (nameMatch?.[1] === 'image' && filenameMatch) {
      return {
        fileData: Buffer.from(content, 'binary'),
        fileName: filenameMatch[1],
        fileType: typeMatch?.[1] ?? 'image/jpeg',
      }
    }
  }

  throw new Error('No image file provided')
}

// POST /api/tasks?resource=image-upload — stores a document image in Vercel
// Blob. This lives under the existing tasks function because documents already
// use that resource router, keeping the deployment within Vercel's 12-function
// Hobby limit.
export async function handleImageUpload(req, res, services = {}) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const { fileData, fileName, fileType } = await parseMultipartForm(req)

    if (fileData.length > MAX_IMAGE_BYTES) {
      res.statusCode = 400
      res.end(
        JSON.stringify({ error: `Image size exceeds ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit` }),
      )
      return
    }

    if (!ALLOWED_TYPES.includes(fileType)) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}` }))
      return
    }

    const putBlob = services.putBlob ?? put
    const blob = await putBlob(fileName, fileData, {
      access: 'public',
      contentType: fileType,
    })

    res.statusCode = 200
    res.end(JSON.stringify({ url: blob.url }))
  } catch (error) {
    console.error('Failed to upload image:', error)
    const errorMessage = error.message || 'Failed to upload image'
    if (
      errorMessage.includes('Content-Type') ||
      errorMessage.includes('boundary') ||
      errorMessage.includes('No image')
    ) {
      res.statusCode = 400
    } else {
      res.statusCode = 500
    }
    res.end(JSON.stringify({ error: errorMessage }))
  }
}
