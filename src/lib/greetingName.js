// The first name to greet someone by, from their Auth0 claims. Auth0 fills
// `name` with the email address when the identity provider has no real name
// for the account, and "Hi allisteraall@gmail.com" reads like a form letter.
// Prefer the claims that carry an actual name, and give '' rather than an
// address so the caller greets without one.
export function greetingNameOf(claims) {
  const named = [claims?.given_name, claims?.nickname, claims?.name]
    .map((claim) => String(claim ?? '').trim())
    .find((claim) => claim && !claim.includes('@'))
  return named ? named.split(/\s+/)[0] : ''
}
