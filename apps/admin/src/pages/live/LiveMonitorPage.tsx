import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleSlash,
  MonitorPlay,
  Pause,
  Plus,
  RefreshCw,
  RotateCcw,
  UserMinus,
} from 'lucide-react'
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  type Column,
} from '../../components/ui'
import { useApiErrorMessage } from '../../hooks/useApiErrorMessage'
import { ApiError, examSessionMutations, examsApi, studentMutations } from '../../services'
import type { LiveExamSession } from '../../types'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** mm:ss from a seconds count. */
function countdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** Seconds until the next whole-second tick, for a live countdown. */
function useTicker(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

type PendingAction =
  | { kind: 'sign-out'; session: LiveExamSession }
  | { kind: 'end-attempt'; session: LiveExamSession }
  | { kind: 'reset-exam'; session: LiveExamSession }
  | { kind: 'extend-time'; session: LiveExamSession; minutes: number }

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Live examination monitor (§55).
 *
 * Exam day's working screen: who is writing right now, how far through
 * they are, and the three interventions that actually come up — sign a
 * candidate out of the portal, close a stuck attempt early (graded, so
 * the candidate still gets a result), and wipe an attempt so a candidate
 * can sit a paper again.
 *
 * The list polls rather than opens a socket: a hall refresh of every few
 * seconds is indistinguishable from a live socket on this screen, and a
 * poll cannot leave a half-open stream behind when the network drops.
 */
export function LiveMonitorPage() {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<PendingAction | null>(null)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  /** Minutes proposed for the current extend-time action. */
  const [extendMinutes, setExtendMinutes] = useState(10)
  /** Polling is opt-out: an invigilator watching one hall does not need it. */
  const [polling, setPolling] = useState(true)
  const nowMs = useTicker()

  const query = useQuery({
    queryKey: ['live-sessions'],
    queryFn: () => examsApi.liveSessions({ limit: 200 }),
    // Every 30s, not every few: one hall's worth of change per minute is
    // indistinguishable from live on this screen, and a gentler poll keeps
    // the monitor from being the reason the exam server is busy.
    refetchInterval: polling ? 30_000 : false,
    // A background tab is not being watched, so it does not poll; switching
    // back re-renders from the cache instead of firing a fresh request.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })
  const message = useApiErrorMessage(query.error)

  const sessions = useMemo(() => query.data ?? [], [query.data])
  const overdue = sessions.filter((s) => s.secondsRemaining === 0).length

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['live-sessions'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }, [queryClient])

  const runAction = useCallback(async () => {
    if (!action) return
    setMutating(true)
    setMutationError(null)
    try {
      if (action.kind === 'end-attempt') {
        await examSessionMutations.forceSubmit(action.session.sessionId)
      } else if (action.kind === 'reset-exam') {
        await examSessionMutations.resetAttempts(action.session.examId, [
          action.session.admissionNumber,
        ])
      } else if (action.kind === 'extend-time') {
        await examSessionMutations.extendSession(
          action.session.sessionId,
          action.minutes,
        )
      } else {
        // Signing the candidate out of the portal: the same operation
        // the students screen calls, clearing any live session and the
        // single-session block so they can sign in again.
        await studentMutations.endSession(action.session.studentRecordId)
      }      invalidate()
      setAction(null)
    } catch (err) {
      setMutationError(err instanceof ApiError ? err.message : 'The request could not be completed')
    } finally {
      setMutating(false)
    }
  }, [action, invalidate])

  const columns: Column<LiveExamSession>[] = [
    {
      key: 'studentName',
      header: 'Candidate',
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{s.studentName}</p>
          <p className="truncate text-2xs text-slate-500">{s.admissionNumber}</p>
        </div>
      ),
    },
    {
      key: 'examTitle',
      header: 'Examination',
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate text-slate-800">{s.examTitle}</p>
          <p className="truncate text-2xs text-slate-500">
            {s.className ?? 'No class'} · attempt {s.attemptNumber}
          </p>
        </div>
      ),
    },
    {
      key: 'startedAt',
      header: 'Started',
      width: 'w-24',
      cell: (s) => <span className="tabular text-slate-600">{clockTime(s.startedAt)}</span>,
    },
    {
      key: 'secondsRemaining',
      header: 'Time left',
      width: 'w-28',
      cell: (s) => {
        // The page ticks every second, so the countdown is exact without
        // another server round trip; `nowMs` is what drives the re-render.
        const live = Math.max(0, Math.floor((Date.parse(s.expiresAt) - nowMs) / 1000))
        return (
          <Badge tone={live === 0 ? 'warning' : 'success'}>
            {live === 0 ? 'Overdue' : countdown(live)}
          </Badge>
        )
      },
    },
    {
      key: 'answeredCount',
      header: 'Answered',
      width: 'w-28',
      align: 'right',
      cell: (s) => (
        <span className="tabular text-slate-600">
          {s.answeredCount}/{s.totalQuestions}
        </span>
      ),
    },
    {
      key: 'violationCount',
      header: 'Flags',
      width: 'w-16',
      align: 'center',
      cell: (s) =>
        s.violationCount > 0 ? (
          <Badge tone="warning">{s.violationCount}</Badge>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      key: 'lastIpAddress',
      header: 'IP',
      width: 'w-32',
      hideBelow: 'lg',
      cell: (s) => (
        <span className="tabular text-2xs text-slate-500">{s.lastIpAddress ?? '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 'w-40',
      align: 'right',
      cell: (s) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={<UserMinus className="h-3.5 w-3.5" />}
            onClick={() => setAction({ kind: 'sign-out', session: s })}
          >
            Sign out
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<CircleSlash className="h-3.5 w-3.5" />}
            onClick={() => setAction({ kind: 'end-attempt', session: s })}
          >
            End attempt
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => setAction({ kind: 'reset-exam', session: s })}
          >
            Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setExtendMinutes(10)
              setAction({ kind: 'extend-time', session: s, minutes: 10 })
            }}
          >
            Extend time
          </Button>
        </div>
      ),
    },
  ]

  const confirmCopy = action
    ? (() => {
        const extend = action.kind === 'extend-time' ? action : null
        return {
          'sign-out': {
            title: `Sign out ${action.session.studentName}?`,
            message:
              'Their portal session ends immediately and they must sign in again with their admission number. An in-progress attempt keeps its clock and stays resumable on the same device.',
            confirm: 'Sign out',
          },
          'end-attempt': {
            title: `End ${action.session.studentName}'s attempt?`,
            message: `"${action.session.examTitle}" is closed now and graded from the answers saved so far. The candidate keeps the attempt — this cannot be undone, though you can reset it afterwards.`,
            confirm: 'End attempt',
          },
          'reset-exam': {
            title: `Reset ${action.session.studentName}'s attempt?`,
            message: `Their attempt on "${action.session.examTitle}" — and its result — is deleted, so they may sit the paper again from the start. Their portal sign-in is ended as well, so the device the old attempt ran on cannot refuse the new sign-in.`,
            confirm: 'Reset attempt',
          },
          'extend-time': {
            title: `Extend ${action.session.studentName}'s time?`,
            message: `Add ${extend?.minutes ?? 10} minute(s) to the clock for "${action.session.examTitle}". The candidate keeps working with the new deadline.`,
            confirm: 'Add time',
          },
        }[action.kind]
      })()
    : null

  return (
    <div className="space-y-5">
      <PageHeader
        title="Live exam monitor"
        description="Candidates writing right now, and the invigilator's interventions"
        actions={
          <>
            <Badge tone={overdue > 0 ? 'warning' : 'success'} dot>
              {sessions.length > 0 ? `${sessions.length} writing now` : 'No active attempts'}
            </Badge>
            <Button
              variant={polling ? 'secondary' : 'primary'}
              icon={<Pause className="h-4 w-4" />}
              onClick={() => setPolling((value) => !value)}
            >
              {polling ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw className={query.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
              onClick={() => void query.refetch()}
            >
              Refresh
            </Button>
          </>
        }
      />

      {overdue > 0 && (
        <Panel>
          <PanelBody className="flex items-center gap-3 py-3">
            <Badge tone="warning">{overdue} overdue</Badge>
            <p className="text-xs text-slate-600">
              These attempts have run past their clock but were never closed — usually a browser
              closed without submitting. End the attempt to grade what was answered.
            </p>
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Attempts in progress"
          description={polling ? 'Refreshes automatically every 30 seconds' : 'Auto-refresh paused'}
        />
        <PanelBody flush>
          {query.isPending ? (
            <LoadingState label="Loading live attempts…" rows={5} />
          ) : message ? (
            <ErrorState title="Live monitor unavailable" message={message} onRetry={() => void query.refetch()} />
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={<MonitorPlay className="h-8 w-8" />}
              title="Nobody is writing"
              description="Candidates who start an examination appear here while it is in progress."
            />
          ) : (
            <DataTable columns={columns} rows={sessions} rowKey={(s) => s.sessionId} />
          )}
        </PanelBody>
      </Panel>

      {confirmCopy && action && (
        <ConfirmDialog
          open
          title={confirmCopy.title}
          message={
            mutationError
              ? `${confirmCopy.message} (Failed: ${mutationError})`
              : confirmCopy.message
          }
          confirmLabel={confirmCopy.confirm}
          destructive
          loading={mutating}
          onConfirm={() => void runAction()}
          onCancel={() => {
            setAction(null)
            setMutationError(null)
          }}
        >
          {action.kind === 'extend-time' && (
            <div className="flex items-center gap-2">
              <label className="text-2xs font-medium text-slate-600">
                Minutes to add
              </label>
              <Input
                type="number"
                min="1"
                max="180"
                value={extendMinutes}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(180, Number(e.target.value) || 1))
                  setExtendMinutes(v)
                  if (action.kind === 'extend-time') {
                    setAction({ ...action, minutes: v })
                  }
                }}
                className="w-20"
              />
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}
