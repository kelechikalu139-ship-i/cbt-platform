/**
 * Applies the institution's primary colour as CSS custom properties on the
 * document root, so every themed surface (buttons, sidebar mark, focus rings)
 * follows `branding.primaryColor` without a rebuild.
 *
 * A contrasting text colour (`--cb-primary-text`, black or white) and a light
 * background tint (`--cb-primary-bg`) are computed from the primary colour so
 * text over primary backgrounds always meets contrast expectations. Passing
 * `null` removes the inline override so the compile-time defaults in
 * `index.css` take effect again.
 */

export interface Branding {
  schoolName: string
  schoolShortName: string
  primaryColor: string | null
  logoUrl: string | null
}

/**
 * How far the tinted surface is lightened toward white. The tint has to be
 * very light: it sits behind text, and a tint that stays close to the brand
 * colour leaves the two almost indistinguishable.
 */
const TINT_WHITENESS = 0.92

/**
 * The near-black the deep brand shade is mixed towards. Mixing rather than
 * plain darkening keeps the brand hue while guaranteeing the result stays
 * dark enough to read on the tint, whatever colour the institution picks.
 */
const INK_COLOR = '#111827'

/** How far the deep brand shade is mixed towards `INK_COLOR`. */
const INK_MIX = 0.65

export function applyBranding(branding: Branding | null): void {
  const root = document.documentElement

  if (branding?.primaryColor) {
    root.style.setProperty('--cb-primary', branding.primaryColor)
    root.style.setProperty('--cb-primary-dark', darken(branding.primaryColor, 0.18))
    root.style.setProperty('--cb-primary-bg', tint(branding.primaryColor, TINT_WHITENESS))
    root.style.setProperty('--cb-primary-deep', mix(branding.primaryColor, INK_COLOR, INK_MIX))
    root.style.setProperty('--cb-primary-text', bestTextColor(branding.primaryColor))
  } else {
    for (const prop of [
      '--cb-primary',
      '--cb-primary-dark',
      '--cb-primary-bg',
      '--cb-primary-deep',
      '--cb-primary-text',
    ]) {
      root.style.removeProperty(prop)
    }
  }
}

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const c = hex.startsWith('#') ? hex.slice(1) : hex
  if (c.length !== 6) return null
  const num = parseInt(c, 16)
  if (Number.isNaN(num)) return null
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  }
}

function toHex(r: number, g: number, b: number): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Darken a hex colour by `amount` (0..1). */
function darken(hex: string, amount = 0.18): string {
  const rgb = parseRgb(hex)
  if (!rgb) return hex
  const r = Math.max(0, Math.floor(rgb.r * (1 - amount)))
  const g = Math.max(0, Math.floor(rgb.g * (1 - amount)))
  const b = Math.max(0, Math.floor(rgb.b * (1 - amount)))
  return toHex(r, g, b)
}

/** Lighten a hex colour toward white by `amount` (0..1), for a light bg tint. */
function tint(hex: string, amount = TINT_WHITENESS): string {
  const rgb = parseRgb(hex)
  if (!rgb) return hex
  const r = Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * amount))
  const g = Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * amount))
  const b = Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * amount))
  return toHex(r, g, b)
}

/** Mix a hex colour toward `to` by `amount` (0..1). */
function mix(from: string, to: string, amount: number): string {
  const a = parseRgb(from)
  const b = parseRgb(to)
  if (!a || !b) return from
  const r = Math.round(a.r + (b.r - a.r) * amount)
  const g = Math.round(a.g + (b.g - a.g) * amount)
  const b2 = Math.round(a.b + (b.b - a.b) * amount)
  return toHex(r, g, b2)
}

/** Relative luminance of an sRGB colour (W3C WCAG). */
function luminance(hex: string): number {
  const rgb = parseRgb(hex)
  if (!rgb) return 0
  const s = [rgb.r, rgb.g, rgb.b].map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]
}

/** WCAG contrast ratio between two colours (lighter / darker). */
function contrastRatio(lumA: number, lumB: number): number {
  const light = Math.max(lumA, lumB)
  const dark = Math.min(lumA, lumB)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * Picks the text colour (`'light'` = white, `'dark'` = near-black) that
 * gives the best WCAG contrast against the given colour. Instead of a
 * naive luminance threshold, this compares the contrast ratio against
 * both white and black and returns whichever is higher — so any brand
 * colour gets perfectly readable text on top of it.
 */
function bestTextColor(hex: string): string {
  const lum = luminance(hex)
  const blackLum = luminance('#111827')
  const whiteLum = 1

  const vsWhite = contrastRatio(lum, whiteLum)
  const vsBlack = contrastRatio(lum, blackLum)

  return vsWhite >= vsBlack ? '#ffffff' : '#111827'
}
