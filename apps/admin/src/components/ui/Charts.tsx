import { cn, formatNumber } from '../../utils'

/**
 * Minimal, dependency-free charts.
 *
 * A charting library would add several hundred kilobytes to an application that
 * must run on school lab machines with no internet. These render plain SVG and
 * inherit the design tokens, which keeps the bundle small and the styling
 * consistent.
 */

/* -------------------------------------------------------------------------- */
/* BarChart                                                                    */
/* -------------------------------------------------------------------------- */

export interface BarChartDatum {
  label: string
  /** Primary value, e.g. submissions. */
  value: number
  /** Optional secondary series, e.g. passes. */
  secondary?: number
}

export interface BarChartProps {
  data: BarChartDatum[]
  height?: number
  className?: string
  primaryLabel?: string
  secondaryLabel?: string
}

export function BarChart({
  data,
  height = 148,
  className,
  primaryLabel = 'Submitted',
  secondaryLabel = 'Passed',
}: BarChartProps) {
  const max = Math.max(1, ...data.flatMap((d) => [d.value, d.secondary ?? 0]))

  return (
    <figure className={cn('w-full', className)}>
      <div
        className="flex items-end gap-1.5"
        style={{ height }}
        role="img"
        aria-label={`${primaryLabel} and ${secondaryLabel} over the last ${data.length} days`}
      >
        {data.map((d, i) => (
          <div
            key={`${d.label}-${i}`}
            className="group relative flex h-full flex-1 items-end justify-center gap-0.5"
            title={`${d.label}: ${formatNumber(d.value)} ${primaryLabel.toLowerCase()}${
              d.secondary !== undefined ? `, ${formatNumber(d.secondary)} ${secondaryLabel.toLowerCase()}` : ''
            }`}
          >
            {d.secondary !== undefined && (
              <div
                className="w-full max-w-[9px] rounded-t bg-brand-600"
                style={{ height: `${(d.secondary / max) * 100}%` }}
              />
            )}
            <div
              className="w-full max-w-[9px] rounded-t bg-brand-200 transition-colors group-hover:bg-brand-300"
              style={{ height: `${(d.value / max) * 100}%` }}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-2xs text-slate-400">
        {data.map((d, i) => (
          <span key={`${d.label}-axis-${i}`} className="flex-1 text-center">
            {d.label}
          </span>
        ))}
      </div>

      <figcaption className="mt-3 flex items-center gap-4 text-2xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-sm bg-brand-200" />
          {primaryLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-sm bg-brand-600" />
          {secondaryLabel}
        </span>
      </figcaption>
    </figure>
  )
}

/* -------------------------------------------------------------------------- */
/* HorizontalBarList                                                           */
/* -------------------------------------------------------------------------- */

export interface HorizontalBarListProps {
  items: Array<{ label: string; value: number; meta?: string }>
  /** Value that maps to a full bar. Defaults to 100 for percentages. */
  max?: number
  suffix?: string
  className?: string
}

/**
 * Ranked horizontal bars — used for subject performance.
 * Clearer than a pie chart when the administrator is scanning for the weakest
 * subject rather than reading exact values.
 */
export function HorizontalBarList({
  items,
  max = 100,
  suffix = '%',
  className,
}: HorizontalBarListProps) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-400">No data yet</p>
  }

  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((item) => {
        const pct = max > 0 ? Math.min(100, (item.value / max) * 100) : 0
        const tone =
          item.value >= 70 ? 'bg-emerald-500' : item.value >= 50 ? 'bg-brand-500' : 'bg-amber-500'

        return (
          <li key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-xs text-slate-600">{item.label}</span>
              <span className="tabular shrink-0 text-xs font-semibold text-slate-800">
                {item.value}
                {suffix}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn('h-full rounded-full', tone)}
                style={{ width: `${pct}%` }}
              />
            </div>
            {item.meta && <p className="mt-0.5 text-2xs text-slate-400">{item.meta}</p>}
          </li>
        )
      })}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                   */
/* -------------------------------------------------------------------------- */

export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  className?: string
}

export function Sparkline({ values, width = 72, height = 22, className }: SparklineProps) {
  if (values.length < 2) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = width / (values.length - 1)

  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`)
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
