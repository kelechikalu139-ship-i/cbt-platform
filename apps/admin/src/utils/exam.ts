import type { ResultGrade } from '../types'

/**
 * Presentation helpers for examinations and grading.
 *
 * Grading is authoritative on the server. These functions mirror the server's
 * rule so the admin UI can *display* a grade consistently, but nothing here
 * decides a student's outcome.
 */

/** Standard grading bands. Adjust to match the institution's policy. */
export const GRADE_BANDS: Array<{ grade: ResultGrade; min: number }> = [
  { grade: 'A', min: 75 },
  { grade: 'B', min: 65 },
  { grade: 'C', min: 55 },
  { grade: 'D', min: 45 },
  { grade: 'E', min: 40 },
  { grade: 'F', min: 0 },
]

export function gradeFor(percentage: number): ResultGrade {
  const band = GRADE_BANDS.find((b) => percentage >= b.min)
  return band?.grade ?? 'F'
}

/**
 * True while an exam's window is open.
 *
 * The server owns `status` and is the only authority on whether a candidate may
 * start; this is presentation-only and drives countdowns and disabled buttons.
 */
export function isExamOpen(startAt: string, endAt: string, now: Date = new Date()): boolean {
  const t = now.getTime()
  return t >= new Date(startAt).getTime() && t <= new Date(endAt).getTime()
}

/**
 * Tailwind classes per status, used by StatusBadge and table cells.
 *
 * Keyed by the server's uppercase enum values, so a lookup that misses simply
 * falls through to the neutral tone rather than rendering unstyled.
 */
export const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  PUBLISHED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  ONGOING: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  IN_PROGRESS: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  COMPLETED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  SUBMITTED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  NOT_STARTED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  ARCHIVED: 'bg-slate-100 text-slate-500 ring-slate-500/20',
  INACTIVE: 'bg-slate-100 text-slate-500 ring-slate-500/20',
  SUSPENDED: 'bg-red-50 text-red-700 ring-red-600/20',
  EXPIRED: 'bg-red-50 text-red-700 ring-red-600/20',
  ABANDONED: 'bg-red-50 text-red-700 ring-red-600/20',
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warn: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  error: 'bg-red-50 text-red-700 ring-red-600/20',
  unknown: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  passed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
}

export const HEALTH_TONE: Record<string, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
  unknown: 'bg-slate-400',
}
