import { Buffer } from 'node:buffer'

import { put } from '@vercel/blob'

import { createServices } from './_lib/services.js'

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

  let fileData = null
  let fileName = null
  let fileType = null

  for (const part of parts) {
    if (part.includes('Content-Disposition')) {
      const headersEnd = part.indexOf('\r\n\r\n')
      if (headersEnd === -1) continue

      const headers = part.substring(0, headersEnd)
      const content = part.substring(headersEnd + 4)

      const nameMatch = headers.match(/name="([^"]+)"/)
      const filenameMatch = headers.match(/filename="([^"]+)"/)
      const typeMatch = headers.match(/Content-Type: ([^\r\n]+)/)

      if (nameMatch && nameMatch[1] === 'image' && filenameMatch) {
        fileName = filenameMatch[1]
        fileType = typeMatch ? typeMatch[1] : 'image/jpeg'
        fileData = Buffer.from(content, 'binary')
      }
    }
  }

  if (!fileData) {
    throw new Error('No image file provided')
  }

  return { fileData, fileName, fileType }
}

export function createHandler(overrides = {}) {
  const services = createServices(overrides)
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')

    try {
      await services.verifyAccessToken(req)
    } catch {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

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
        res.end(
          JSON.stringify({ error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}` }),
        )
        return
      }

      const blob = await put(fileName, fileData, {
        access: 'public',
        contentType: fileType,
      })

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
}

export default createHandler()
