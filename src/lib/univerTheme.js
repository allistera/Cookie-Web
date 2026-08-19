// Derives a Univer color theme from this app's own CSS custom properties
// (assets/main.css) so an embedded sheet's selection highlight, buttons, and
// focus rings read as the same accent as the rest of the UI instead of
// Univer's stock indigo. Only `primary` is overridden — `gray`/`white`/
// `black` stay Univer's own defaults so its built-in dark-mode derivation
// (FUniver#toggleDarkMode) keeps working as designed.

function readCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '')
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((channel) => channel + channel)
          .join('')
      : normalized
  const int = Number.parseInt(value, 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function mix(hex, towardHex, amount) {
  const from = hexToRgb(hex)
  const to = hexToRgb(towardHex)
  const channel = (a, b) => Math.round(a + (b - a) * amount)
  const toHex = (n) => n.toString(16).padStart(2, '0')
  return `#${toHex(channel(from.r, to.r))}${toHex(channel(from.g, to.g))}${toHex(channel(from.b, to.b))}`.toUpperCase()
}

// Lighter tints toward white, darker shades toward black — 500 is the accent
// itself, matching the shape of Univer's own default.primary ramp.
const LIGHTEN_STEPS = { 50: 0.94, 100: 0.86, 200: 0.7, 300: 0.52, 400: 0.26 }
const DARKEN_STEPS = { 600: 0.14, 700: 0.3, 800: 0.46, 900: 0.62 }

function primaryRamp(accent) {
  const ramp = { 500: accent }
  for (const [stop, amount] of Object.entries(LIGHTEN_STEPS)) ramp[stop] = mix(accent, '#FFFFFF', amount)
  for (const [stop, amount] of Object.entries(DARKEN_STEPS)) ramp[stop] = mix(accent, '#000000', amount)
  return ramp
}

export function buildUniverTheme(defaultTheme) {
  const accent = readCssVar('--accent', '#5e6ad2')
  return { ...defaultTheme, primary: primaryRamp(accent) }
}
