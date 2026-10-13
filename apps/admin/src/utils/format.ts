/**
 * Display formatters. All of these are pure and locale-stable so that numbers
 * and dates render identically on every lab PC regardless of OS locale.
 */

import type { DecimalString } from '../types'

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d)
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : timeFmt.format(d)
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(fractionDigits)}%`
}

/** Milliseconds -> human duration, e.g. 5461 -> "1h 31m". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Bytes -> human size, e.g. 1073741824 -> "1.0 GB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** "Adebayo Fashola" -> "AF". */
export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '—'
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

/**
 * Coerce a `DecimalString` from the wire to a number for arithmetic or display.
 *
 * Accepts a real number too, so the same call site works against fixtures and
 * against the API — fixtures author decimals as numbers for readability, and
 * making that a type error would only push the problem somewhere less honest.
 * Returns `null` rather than `NaN` for unusable input, so a bad value renders as
 * "—" instead of "NaN" or poisoning a downstream sum.
 */
export function toDecimalNumber(value: DecimalString | number | null | undefined): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Format a `DecimalString` as a percentage, trimming meaningless trailing zeros. */
export function formatDecimalPercent(
  value: DecimalString | number | null | undefined,
): string {
  const parsed = toDecimalNumber(value)
  if (parsed === null) return '—'
  return `${Number.isInteger(parsed) ? parsed : parsed.toFixed(1)}%`
}

/**
 * Truncated opaque identifier for display, e.g. a UUID -> "3f9a2c41".
 *
 * Entity IDs are UUIDs with no meaningful content, so tables show a short prefix
 * rather than a 36-character string. The full value stays in the `title`
 * attribute, where it can still be copied and pasted into an API call.
 */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—'
  return id.length <= 8 ? id : id.slice(0, 8)
}

/** Relative time for activity feeds, e.g. "4 minutes ago". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffSeconds = Math.round((Date.now() - then) / 1000)
  if (diffSeconds < 45) return 'just now'
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month'],
  ]
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  let prev = 1
  for (const [limit, unit] of units) {
    if (diffSeconds < limit) {
      return rtf.format(-Math.floor(diffSeconds / prev), unit)
    }
    prev = limit
  }
  return rtf.format(-Math.floor(diffSeconds / 31557600), 'year')
}
