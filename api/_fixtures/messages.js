import { fixtureEmails, fixtureSentEmails } from './emails.js'

// Fixture body for GET /api/messages, served by the local Vite middleware in
// e2e mode (and dev without DATABASE_URL). The first fixture message carries a
// deliberately hostile HTML body — a <script> tag and an onerror <img> plus a
// javascript: link — so manual/e2e testing proves the sanitizer (layer 1) and
// the no-script sandboxed iframe (layer 2) neutralize sender-controlled HTML.
// Other messages return no HTML body, exercising the plain-text fallback.
const HOSTILE_HTML = `
  <div>
    <h1>Revised Floor Plan</h1>
    <p>Hi Allister, here is the <strong>updated design</strong> bringing more natural light into the kitchen.</p>
    <script>window.top.document.title = 'pwned'</script>
    <img src="x" onerror="window.top.location='https://evil.example/steal'" alt="">
    <table border="1" cellpadding="4">
      <tr><th>Room</th><th>Size</th></tr>
      <tr><td>Kitchen</td><td>18 x 14</td></tr>
      <tr><td>Breakfast nook</td><td>10 x 9</td></tr>
    </table>
    <p><a href="https://cityconstruction.com/plan">View the full plan</a></p>
    <p><a href="javascript:alert('xss')">Do not click</a></p>
  </div>`

export function fixtureMessageBody(id) {
  if (id === 'fixture-1') {
    return {
      id,
      body_html: HOSTILE_HTML,
      body_text:
        'Hi Allister, here is the updated design bringing more natural light into the kitchen.',
      unsubscribe: null,
      thread: [
        {
          id: 'fixture-1-earlier',
          from_name: 'City Construction',
          from_address: 'updates@cityconstruction.com',
          snippet: 'Quick check-in before we finalize the kitchen floor plan design.',
          body_text:
            'Hi Allister, quick check-in before we finalize the kitchen floor plan design — any thoughts on the window placement we discussed?',
          sent_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
          is_sent: false,
        },
        {
          id,
          from_name: 'City Construction',
          from_address: 'updates@cityconstruction.com',
          snippet: 'Hi Allister, here is the updated design bringing more natural light...',
          body_text:
            'Hi Allister, here is the updated design bringing more natural light into the kitchen.',
          sent_at: new Date(Date.now() - 0.5 * 60 * 60 * 1000).toISOString(),
          is_sent: false,
        },
      ],
      attachments: [
        {
          id: 'fixture-1-attachment-1',
          filename: 'Revised-Floor-Plan.pdf',
          content_type: 'application/pdf',
          size_bytes: 2_415_820,
          downloadable: true,
        },
      ],
    }
  }
  // The Daily Bites newsletter (see api/_fixtures/emails.js) advertises
  // one-click unsubscribe, in the same parsed shape GET /api/messages returns.
  if (id === 'fixture-15') {
    return {
      id,
      body_html: null,
      body_text:
        'This week we are keeping it simple: five dinners you can get on the table in under 30 minutes.\n\n1. Lemon garlic salmon\n2. Sheet-pan gnocchi\n3. Black bean tacos\n4. Miso noodle soup\n5. Caprese orzo\n\nYou are receiving this because you subscribed to Daily Bites.',
      unsubscribe: {
        oneClick: true,
        url: 'https://news.dailybites.example/unsubscribe?u=42',
        mailto: { address: 'unsubscribe@dailybites.example', subject: null },
      },
      thread: [],
      attachments: [],
    }
  }
  const email = [...fixtureEmails(), ...fixtureSentEmails()].find((row) => row.id === id)
  return {
    id: id ?? null,
    body_html: null,
    body_text: email?.body_text ?? null,
    unsubscribe: null,
    thread: [],
    attachments: [],
  }
}
