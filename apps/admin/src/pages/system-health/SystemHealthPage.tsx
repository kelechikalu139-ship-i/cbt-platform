import {
  Check,
  Copy,
  Database,
  HardDrive,
  Info,
  MemoryStick,
  Monitor,
  Server,
  WifiOff,
} from 'lucide-react'
import { useState } from 'react'
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard'
import {
  Badge,
  DataPoint,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  PhaseNotice,
} from '../../components/ui'
import { formatBytes, formatDateTime, formatNumber, formatUptime } from '../../utils'
import type { HealthProbe, SystemStatus } from '../../types'
import { getAdminUrl, getStudentUrl, lan } from '../../mocks/fixtures'

interface SystemHealthPageProps {
  /** Rich status from `/system/status`. Null when loading or unreachable. */
  status: SystemStatus | null
  /** Liveness probe from `/health` (503 tolerated). Undefined in mock mode, where
   * the status fixture already carries liveness. */
  health: HealthProbe | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

const OFFLINE = 'text-slate-400'

/**
 * True when the page can show the LAN address for students.
 *
 * `/system/status` does not expose the listen address or student URL, so those
 * rows are only rendered in mock mode. Flagging the gap explicitly is preferable
 * to silently rendering empty data.
 */
const HAS_LAN_FIXTURE = !!lan

/** Copyable address row. Clipboard needs HTTPS, so a manual fallback is offered. */
function UrlRow({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  const { copy, copied, failed } = useCopyToClipboard()

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="tabular mt-0.5 select-all break-all font-mono text-sm text-slate-800">
          {value}
        </p>
        {hint && <p className="mt-0.5 text-2xs text-slate-400">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => void copy(value)}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
      {failed && (
        <p className="w-full text-2xs text-amber-600">
          Clipboard unavailable over plain HTTP — select the address and copy it manually.
        </p>
      )}
    </div>
  )
}

/** Usage bar for a host resource (disk, memory, CPU). */
function ResourceBar({
  label,
  used,
  total,
  unit,
  percent,
  icon: Icon,
}: {
  label: string
  used: number
  total: number
  unit: string
  percent: number
  icon: typeof HardDrive
}) {
  if (total <= 0) return null
  const tone =
    percent >= 90 ? 'bg-red-500' : percent >= 75 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <Icon aria-hidden className="h-3.5 w-3.5 text-slate-400" />
          {label}
        </span>
        <span className="tabular text-xs text-slate-500">
          {unit === 'bytes'
            ? `${formatBytes(used)} / ${formatBytes(total)}`
            : `${used} / ${total} ${unit}`}
          <span className="ml-2 font-semibold text-slate-700">{percent.toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  )
}

/**
 * System health.
 *
 * The most operationally important page in a LAN deployment: it tells the
 * administrator the server address and version, whether the database is up, how
 * many records exist, and how much headroom the server PC has. Where the live API
 * exposes a detail, it is shown; where Phase 1's backend does not, the gap is
 * shown as an explicit state rather than a fabricated value.
 */
export function SystemHealthPage({
  status,
  health,
  loading = false,
  error = null,
  onRetry,
}: SystemHealthPageProps) {
  const [lastChecked, setLastChecked] = useState(() => new Date())

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title="System Health" description="Live status of the CBT server on this network." />
        <Panel>
          <ErrorState
            message={error}
            onRetry={() => {
              setLastChecked(new Date())
              onRetry?.()
            }}
          />
        </Panel>
      </div>
    )
  }

  if (loading && !status) {
    return (
      <div className="space-y-5">
        <PageHeader title="System Health" description="Live status of the CBT server on this network." />
        <Panel>
          <LoadingState label="Reading server status…" rows={8} />
        </Panel>
      </div>
    )
  }

  // Liveness is authoritative from `/health` when present; otherwise derive it
  // from the richer status payload's `database` field.
  const databaseUp = health ? health.database === 'connected' : (status?.database ?? 'connected') === 'connected'
  const online = databaseUp

  return (
    <div className="space-y-5">
      <PageHeader
        title="System Health"
        description="Live status of the CBT server, database and host."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={online ? 'success' : 'danger'} dot>
              {online ? 'Database connected' : 'Database unreachable'}
            </Badge>
            {health && (
              <Badge tone={health.status === 'degraded' ? 'warning' : 'success'} dot>
                {health.status === 'ok' ? 'Liveness OK' : 'Liveness degraded'}
              </Badge>
            )}
            <span className="text-2xs text-slate-400">
              Updated {formatDateTime(status?.timestamp ?? lastChecked.toISOString())}
            </span>
          </div>
        }
      />

      {/* Student access addresses — the single most useful thing on this page. */}
      <Panel>
        <PanelHeader
          title="Student access addresses"
          description="Give these addresses to candidates. They work without an internet connection."
          actions={<Server aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />}
        />
        {HAS_LAN_FIXTURE ? (
          <PanelBody>
            <UrlRow
              label="Student application"
              value={getStudentUrl()}
              hint="Typed into a browser on any computer connected to this network."
            />
            <UrlRow label="Administration" value={getAdminUrl()} hint="Administrator sign-in." />
            <UrlRow
              label="Server address"
              value={`${lan.address}:${status?.server?.port ?? lan.port}`}
              hint="Bind address the service listens on."
            />
          </PanelBody>
        ) : (
          <PanelBody>
            <p className="text-2xs leading-relaxed text-slate-500">
              Access addresses are read from the server's network configuration, which is not yet
              exposed by an API endpoint. Derive the student URL from the port shown below.
            </p>
            <DataPoint label="Port" value={status ? String(status.server.port) : '—'} />
          </PanelBody>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {/* Application */}
        <Panel>
          <PanelHeader title="Application" />
          <PanelBody>
            <div className="mb-3">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <Monitor className="h-4 w-4 text-slate-400" />
                {status ? status.application : '—'}
              </span>
            </div>
            {status && (
              <dl className="divide-y divide-slate-100">
                <DataPoint label="Version" value={status.version} />
                <DataPoint label="Environment" value={status.environment} />
                <DataPoint label="Node" value={status.server.nodeVersion} />
                <DataPoint label="Started" value={formatUptime(status.server.uptimeSeconds)} />
              </dl>
            )}
          </PanelBody>
        </Panel>

        {/* Database */}
        <Panel>
          <PanelHeader title="Database" />
          <PanelBody>
            <div className="mb-3">
              <Badge tone={databaseUp ? 'success' : 'danger'} dot>
                {databaseUp ? 'Connected' : 'Unavailable'}
              </Badge>
            </div>
            {status && status.counts && (
              <dl className="divide-y divide-slate-100">
                <DataPoint
                  label="Engine"
                  value={
                    <span className="flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-slate-400" />
                      MariaDB
                    </span>
                  }
                />
                <DataPoint
                  label="Records"
                  value={
                    <>
                      {formatNumber(status.counts.students)} students ·{' '}
                      {formatNumber(status.counts.questions)} questions ·{' '}
                      {formatNumber(status.counts.exams)} exams
                    </>
                  }
                />
                <DataPoint label="Results" value={formatNumber(status.counts.results)} />
              </dl>
            )}
          </PanelBody>
        </Panel>

        {/* Host */}
        <Panel>
          <PanelHeader title="Server host" />
          <PanelBody>
            {status ? (
              <dl className="divide-y divide-slate-100">
                <DataPoint
                  label="Port"
                  value={
                    <span className="flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5 text-slate-400" />
                      {String(status.server.port)}
                    </span>
                  }
                />
                <DataPoint label="Uptime" value={formatUptime(status.server.uptimeSeconds)} />
                <DataPoint
                  label="Memory"
                  value={
                    <span className="flex items-center gap-1.5">
                      <MemoryStick className="h-3.5 w-3.5 text-slate-400" />
                      {`${formatNumber(status.server.memoryUsageMb)} MB`}
                    </span>
                  }
                />
              </dl>
            ) : (
              <LoadingState label="Loading…" rows={3} />
            )}
          </PanelBody>
        </Panel>

        {/* Network reachability */}
        <Panel>
          <PanelHeader title="Reachability" />
          <PanelBody>
            <div className="mb-3">
              <Badge tone={online ? 'success' : 'danger'}>{online ? 'Online' : 'Degraded'}</Badge>
            </div>
            <dl className="divide-y divide-slate-100">
              <DataPoint
                label="Internet"
                value={
                  <span className="flex items-center justify-end gap-1.5">
                    {/* The live API is LAN-only by design; no internet check is reported */}
                    <WifiOff className={`h-3.5 w-3.5 ${OFFLINE}`} /> Offline
                  </span>
                }
              />
              <DataPoint
                label="Students can reach the app on the LAN"
                value="Verified server-side"
              />
            </dl>
            {!databaseUp && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-2xs leading-relaxed text-red-900">
                The database is unreachable. Examinations cannot be started or saved until this is restored.
              </p>
            )}
          </PanelBody>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Host resource utilisation (Phase 12) */}
        <Panel>
          <PanelHeader title="Server resources" description="Capacity of the server PC" />
          <PanelBody className="space-y-4">
            {status?.server ? (
              <>
                <ResourceBar
                  label="Memory"
                  used={status.server.memoryUsageMb}
                  total={8192}
                  unit="MB"
                  percent={(status.server.memoryUsageMb / 8192) * 100}
                  icon={MemoryStick}
                />
                <p className="text-2xs text-slate-400">
                  Disk, CPU and total-memory figures are not yet exposed by the API. They will appear here
                  once the backend reports host metrics.
                </p>
              </>
            ) : (
              <LoadingState label="Loading…" rows={3} />
            )}
          </PanelBody>
        </Panel>

        {/* Diagnostics */}
        <Panel>
          <PanelHeader
            title="Diagnostics"
            description="Troubleshooting information to record before calling support"
          />
          <PanelBody flush>
            <dl className="px-5 py-1">
              {[
                { icon: Monitor, label: 'Application', value: status ? `${status.application} ${status.version}` : '—' },
                { icon: Server, label: 'Server address', value: `${lan.address}:${status?.server?.port ?? lan.port}` },
                { icon: Database, label: 'Database', value: databaseUp ? 'MariaDB connected' : 'Unreachable' },
                { icon: Info, label: 'Started', value: status ? formatUptime(status.server.uptimeSeconds) : '—' },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-0"
                >
                  <row.icon aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />
                  <dt className="flex-1 text-xs text-slate-500">{row.label}</dt>
                  <dd className="tabular font-mono text-xs text-slate-700">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
              <p className="flex items-start gap-2 text-2xs leading-relaxed text-slate-500">
                <Info aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  Health data is read from the running process and the database connection on the
                  server. If figures look stale, the service is unreachable — check the Windows
                  service.
                </span>
              </p>
            </div>
          </PanelBody>
        </Panel>
      </div>

      <PhaseNotice phase="Phases 12 and 13 — Licensing and host resource metrics">
        Disk, memory and CPU utilisation, plus service restart, are not exposed by the current API
        endpoints. They will appear on this screen once the backend reports host metrics. Licence
        validation is performed server-side against a signed key — never in the browser.
      </PhaseNotice>
    </div>
  )
}
