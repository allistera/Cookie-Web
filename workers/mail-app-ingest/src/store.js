// Persists a parsed inbound email into the app's existing tables.
// Returns 'inserted' or 'duplicate'. Throws on any failure — the caller
// treats every store error identically: log it and forward the mail anyway.
//
// The neon() HTTP driver has no interactive transactions, so this runs as
// one lookup SELECT followed by one sql.transaction() batch built with
// client-generated UUIDs. A concurrent retry slipping between the two is
// still blocked by the (user_id, message_id) unique index; the worst case
// is an orphan threads row, which the UI never renders (see RUNBOOK).
export async function storeEmail(sql, record, ownerEmail) {
  const rows = await sql`
    SELECT u.id AS user_id,
           EXISTS (
             SELECT 1 FROM messages m
             WHERE m.user_id = u.id AND m.message_id = ${record.messageId}
           ) AS is_duplicate,
           (
             SELECT m.thread_id FROM messages m
             WHERE m.user_id = u.id AND m.message_id = ANY(${record.references}::text[])
             ORDER BY m.sent_at DESC
             LIMIT 1
           ) AS thread_id
    FROM users u
    WHERE u.email = ${ownerEmail}
    ORDER BY u.created_at
    LIMIT 1
  `
  if (rows.length === 0) {
    throw new Error('no users row matches OWNER_EMAIL; message not stored')
  }
  const { user_id: userId, is_duplicate: isDuplicate, thread_id: matchedThreadId } = rows[0]
  if (isDuplicate) return 'duplicate'

  const threadId = matchedThreadId ?? crypto.randomUUID()
  const messageUuid = crypto.randomUUID()
  const sentAt = record.sentAt.toISOString()

  const queries = []

  if (!matchedThreadId) {
    // message_count defaults to 1 for a fresh thread.
    queries.push(sql`
      INSERT INTO threads (id, user_id, subject, last_message_at)
      VALUES (${threadId}, ${userId}, ${record.subject}, ${sentAt})
    `)
  }

  queries.push(sql`
    INSERT INTO messages (
      id, thread_id, user_id, from_name, from_address, recipients, subject,
      snippet, body_text, body_html, sent_at, message_id, headers, raw_size,
      truncated, envelope_from, envelope_to
    ) VALUES (
      ${messageUuid}, ${threadId}, ${userId}, ${record.fromName}, ${record.fromAddress},
      ${JSON.stringify(record.recipients)}::jsonb, ${record.subject},
      ${record.snippet}, ${record.bodyText}, ${record.bodyHtml}, ${sentAt},
      ${record.messageId}, ${JSON.stringify(record.headers)}::jsonb, ${record.rawSize},
      ${record.truncated}, ${record.envelopeFrom}, ${record.envelopeTo}
    )
    ON CONFLICT (user_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
  `)

  // Metadata only; blob_url stays null until attachment bodies move to R2.
  // If the message insert above was a conflict no-op, these FK inserts fail
  // and roll the whole batch back — the retry is then a clean duplicate.
  for (const attachment of record.attachments) {
    queries.push(sql`
      INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, blob_url)
      VALUES (${crypto.randomUUID()}, ${messageUuid}, ${attachment.filename},
              ${attachment.mime_type}, ${attachment.size}, ${null})
    `)
  }

  if (matchedThreadId) {
    // EXISTS guards the bump: if the message INSERT was an ON CONFLICT no-op
    // (concurrent retry), the counters must not drift.
    queries.push(sql`
      UPDATE threads
      SET message_count = message_count + 1,
          last_message_at = GREATEST(last_message_at, ${sentAt})
      WHERE id = ${matchedThreadId}
        AND EXISTS (SELECT 1 FROM messages WHERE id = ${messageUuid})
    `)
  }

  await sql.transaction(queries)
  return 'inserted'
}
