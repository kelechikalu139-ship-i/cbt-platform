import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Loader2,
  Send,
  X,
} from 'lucide-react'
import { Badge, Button, Card, Modal, ProgressBar, Skeleton, Spinner } from '../../components/common'
import { examAPI } from '../../services/api'
import { formatTime, cn } from '../../utils'

/** Question types as the portal maps them for the browser. */
type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer'

interface Question {
  id: string
  type: QuestionType
  question: string
  options?: string[]
  points: number
  order: number
}

interface SessionData {
  id: string
  exam: { id: string; title: string; duration: number }
  questions: Question[]
  answers: Record<string, string>
  currentQuestion: number
  timeRemaining: number
  status: string
}

/** What the candidate sees as their answer is written to the server. */
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export const ExamTakePage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<SessionData | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentQ, setCurrentQ] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  /** The submit confirmation dialog, and the flight of the submit itself. */
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  /* ---------------------------------------------------------------- start */

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      try {
        const res = await examAPI.startSession(id!)
        if (cancelled) return
        const data: SessionData = res.data.data
        setSession(data)
        setAnswers(data.answers || {})
        setCurrentQ(data.currentQuestion || 0)
        setTimeLeft(data.timeRemaining || data.exam.duration * 60)
      } catch (err) {
        if (cancelled) return
        const message =
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
          'This examination could not be started.'
        setLoadError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void start()
    return () => {
      cancelled = true
    }
  }, [id])

  /* ---------------------------------------------------------------- timer */

  useEffect(() => {
    if (timeLeft <= 0 || !session) return
    const timer = window.setInterval(() => setTimeLeft((t) => t - 1), 1000)
    return () => window.clearInterval(timer)
  }, [timeLeft, session])

  /* --------------------------------------------------------------- submit */

  const submitNow = useCallback(
    async (sessionId: string) => {
      setSubmitting(true)
      setSubmitError(null)
      try {
        await examAPI.submitSession(sessionId)
        navigate(`/results/${sessionId}`)
      } catch (err) {
        // The attempt is still open on the server, so the candidate keeps
        // their paper: the failure is reported where they can act on it.
        const message =
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
          'Your answers could not be submitted. Please try again.'
        setSubmitError(message)
        setSubmitting(false)
      }
    },
    [navigate],
  )

  /** Opens the confirmation dialog; the submit itself never fires directly. */
  const requestSubmit = useCallback(() => {
    setSubmitError(null)
    setSubmitOpen(true)
  }, [])

  const autoSubmitted = useRef(false)
  useEffect(() => {
    if (timeLeft > 0 || !session || autoSubmitted.current) return
    // Time is up: no confirmation, because there is nothing left to decide.
    autoSubmitted.current = true
    void submitNow(session.id)
  }, [timeLeft, session, submitNow])

  /* -------------------------------------------------------------- answers */

  const handleAnswer = useCallback(
    async (questionId: string, answer: string) => {
      if (!session) return
      setAnswers((prev) => ({ ...prev, [questionId]: answer }))
      setSaveState('saving')
      try {
        await examAPI.saveAnswer(session.id, questionId, answer)
        setSaveState('saved')
      } catch (err) {
        console.error('Failed to save answer', err)
        // The answer stays in the browser so nothing is lost visually; the
        // indicator says the write has not landed and the next save retries.
        setSaveState('error')
      }
    },
    [session],
  )

  const questions = session?.questions ?? []
  const question = questions[currentQ]
  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== '').length,
    [questions, answers],
  )
  const unanswered = useMemo(
    () => questions.map((q, i) => ({ q, i })).filter(({ q }) => !answers[q.id]),
    [questions, answers],
  )
  const locked = timeLeft <= 0 || submitting

  /* --------------------------------------------------------------- render */

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm">
          <div className="space-y-2">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-11 w-24 rounded-lg" />
        </div>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="mt-2 h-6 w-4/5" />
          <div className="mt-6 space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </Card>
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-500">
          <Spinner className="h-4 w-4 text-indigo-600" />
          Preparing your paper…
        </div>
      </div>
    )
  }

  if (loadError || !session) {
    return (
      <div className="mx-auto max-w-lg py-12">
        <Card>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <X className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">This examination could not start</h2>
            <p className="mt-2 text-sm text-gray-600">{loadError}</p>
            <Button className="mt-6" onClick={() => navigate('/exams')}>
              Back to examinations
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!question) return null

  const isLowTime = timeLeft <= 300

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* ------------------------------------------------------------ header */}
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-gray-900">{session.exam.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
              <span>
                Question {currentQ + 1} of {questions.length}
              </span>
              <span aria-hidden>•</span>
              <span className="font-medium text-indigo-600">
                {answeredCount} answered
              </span>
              {saveState === 'saving' && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> saving…
                </span>
              )}
              {saveState === 'saved' && (
                <span className="inline-flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="h-3 w-3" /> saved
                </span>
              )}
              {saveState === 'error' && (
                <span className="text-xs text-amber-600">
                  answer kept locally — not yet saved
                </span>
              )}
            </div>
          </div>
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 font-mono text-xl font-bold tabular-nums',
              isLowTime ? 'animate-pulse bg-red-50 text-red-700' : 'bg-indigo-50 text-indigo-700',
            )}
            aria-label="Time remaining"
          >
            <Clock className="h-4 w-4" aria-hidden />
            {formatTime(Math.max(0, timeLeft))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar value={answeredCount} max={questions.length} className="flex-1" />
          <span className="shrink-0 text-xs text-gray-500">
            {questions.length - answeredCount} left
          </span>
        </div>
      </div>

      {locked && submitting && (
        <p className="rounded-lg bg-indigo-50 px-4 py-2.5 text-center text-sm font-medium text-indigo-700">
          Submitting your answers…
        </p>
      )}
      {locked && !submitting && (
        <p className="rounded-lg bg-red-50 px-4 py-2.5 text-center text-sm text-red-600">
          Time is up. Your answers are being submitted automatically.
        </p>
      )}

      {/* ----------------------------------------------------------- question */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <Badge variant="info">Question {currentQ + 1}</Badge>
          <span className="text-sm text-gray-500">{question.points} pts</span>
        </div>
        <p className="mb-6 text-lg font-medium leading-relaxed text-gray-900">
          {question.question}
        </p>

        {question.type === 'multiple_choice' && (
          <div className="space-y-3">
            {question.options?.map((option, i) => {
              const selected = answers[question.id] === option
              return (
                <label
                  key={i}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-4 transition-colors',
                    selected
                      ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                      : 'cursor-pointer border-gray-300 hover:border-indigo-300 hover:bg-gray-50',
                    locked ? 'cursor-not-allowed opacity-70' : '',
                  )}
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={option}
                    checked={selected}
                    onChange={() => void handleAnswer(question.id, option)}
                    disabled={locked}
                    className="h-4 w-4 text-indigo-600"
                  />
                  <span className="text-gray-800">{option}</span>
                </label>
              )
            })}
          </div>
        )}

        {question.type === 'true_false' && (
          <div className="space-y-3">
            {['True', 'False'].map((option) => {
              const selected = answers[question.id] === option
              return (
                <label
                  key={option}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-4 transition-colors',
                    selected
                      ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                      : 'cursor-pointer border-gray-300 hover:border-indigo-300 hover:bg-gray-50',
                    locked ? 'cursor-not-allowed opacity-70' : '',
                  )}
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={option}
                    checked={selected}
                    onChange={() => void handleAnswer(question.id, option)}
                    disabled={locked}
                    className="h-4 w-4 text-indigo-600"
                  />
                  <span className="text-gray-800">{option}</span>
                </label>
              )
            })}
          </div>
        )}

        {question.type === 'short_answer' && (
          <textarea
            value={answers[question.id] || ''}
            onChange={(e) => void handleAnswer(question.id, e.target.value)}
            rows={4}
            disabled={locked}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
            placeholder="Type your answer…"
          />
        )}
      </Card>

      {/* --------------------------------------------------------- navigation */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          icon={<ChevronLeft className="h-4 w-4" />}
          onClick={() => setCurrentQ((q) => Math.max(0, q - 1))}
          disabled={currentQ === 0 || locked}
        >
          Previous
        </Button>

        {currentQ < questions.length - 1 ? (
          <Button
            icon={<ChevronRight className="h-4 w-4" />}
            onClick={() => setCurrentQ((q) => q + 1)}
            disabled={locked}
          >
            Next
          </Button>
        ) : (
          <Button
            icon={<Send className="h-4 w-4" />}
            onClick={requestSubmit}
            disabled={locked}
          >
            Review &amp; submit
          </Button>
        )}
      </div>

      {/* ------------------------------------------------------- navigator */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Questions</h2>
          {unanswered.length > 0 && (
            <button
              type="button"
              onClick={() => setCurrentQ(unanswered[0].i)}
              disabled={locked}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {unanswered.length} unanswered — go to first
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {questions.map((q, i) => {
            const answered = Boolean(answers[q.id])
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setCurrentQ(i)}
                disabled={locked}
                aria-label={`Question ${i + 1}${answered ? ', answered' : ', not answered'}`}
                className={cn(
                  'h-10 w-10 rounded-lg text-sm font-medium transition-colors disabled:opacity-50',
                  i === currentQ
                    ? 'bg-indigo-600 text-white ring-2 ring-indigo-300'
                    : answered
                      ? 'bg-green-100 text-green-800 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {answered && i !== currentQ ? (
                  <CheckCircle2 className="mx-auto h-4 w-4" aria-hidden />
                ) : (
                  i + 1
                )}
              </button>
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-green-100 ring-1 ring-green-300" aria-hidden />
              Answered
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-gray-100 ring-1 ring-gray-300" aria-hidden />
              Not answered
            </span>
          </div>
          <Button
            icon={<Send className="h-4 w-4" />}
            onClick={requestSubmit}
            disabled={locked}
            loading={submitting}
          >
            Submit examination
          </Button>
        </div>
      </Card>

      {/* ----------------------------------------------------- submit dialog */}
      <Modal
        open={submitOpen}
        onClose={() => (submitting ? undefined : setSubmitOpen(false))}
        dismissible={!submitting}
        icon={<ClipboardCheck className="h-6 w-6" aria-hidden />}
        title="Submit examination?"
        description="Are you sure you want to submit? You cannot change your answers afterwards."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setSubmitOpen(false)}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              No, keep working
            </Button>
            <Button
              onClick={() => void submitNow(session.id)}
              loading={submitting}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              {submitting ? 'Submitting…' : 'Yes, submit now'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
            <p className="text-2xl font-bold text-green-700">{answeredCount}</p>
            <p className="text-xs font-medium text-green-700">Answered</p>
          </div>
          <div
            className={cn(
              'rounded-lg border p-3 text-center',
              unanswered.length > 0
                ? 'border-amber-200 bg-amber-50'
                : 'border-gray-200 bg-gray-50',
            )}
          >
            <p
              className={cn(
                'text-2xl font-bold',
                unanswered.length > 0 ? 'text-amber-700' : 'text-gray-700',
              )}
            >
              {unanswered.length}
            </p>
            <p
              className={cn(
                'text-xs font-medium',
                unanswered.length > 0 ? 'text-amber-700' : 'text-gray-500',
              )}
            >
              Not answered
            </p>
          </div>
        </div>

        {unanswered.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {unanswered.length} question{unanswered.length === 1 ? '' : 's'} still unanswered
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unanswered.map(({ i }) => (
                <button
                  key={questions[i].id}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setCurrentQ(i)
                    setSubmitOpen(false)
                  }}
                  className="h-7 min-w-7 rounded-md bg-white px-2 text-xs font-medium text-amber-800 ring-1 ring-amber-300 transition-colors hover:bg-amber-100 disabled:opacity-50"
                >
                  Q{i + 1}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-amber-700">
              Select a question to go back and answer it, or submit now — unanswered questions
              score zero.
            </p>
          </div>
        )}

        {submitError && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {submitError}
          </p>
        )}
      </Modal>

      {/* ------------------------------------------------- submitting overlay */}
      {submitting && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-gray-900/40 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white px-6 py-5 shadow-xl">
            <Spinner className="h-5 w-5 text-indigo-600" />
            <div>
              <p className="font-medium text-gray-900">Submitting your answers…</p>
              <p className="text-sm text-gray-500">Keep this window open until it completes.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
