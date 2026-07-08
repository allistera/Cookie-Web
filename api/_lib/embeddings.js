// OpenAI embeddings client. Used by /api/search for query vectors and by
// scripts/backfill-embeddings.js for message vectors.

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

// ~6k tokens, comfortably under the model's 8191-token input limit.
const MAX_INPUT_CHARS = 24000

// Embeds one string; returns a 1536-number array.
export async function embedText(text, apiKey) {
  const [vector] = await embedBatch([text], apiKey)
  return vector
}

// Embeds several strings in one API call; returns arrays in input order.
export async function embedBatch(texts, apiKey) {
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured')
  }
  // OpenAI rejects empty strings, so blank inputs become a single space.
  const input = texts.map((text) => String(text || ' ').slice(0, MAX_INPUT_CHARS))
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      input,
    }),
  })
  if (!response.ok) {
    throw new Error(`OpenAI embeddings API responded ${response.status}`)
  }
  const { data } = await response.json()
  return data.sort((a, b) => a.index - b.index).map((entry) => entry.embedding)
}
