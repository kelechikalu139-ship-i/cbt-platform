import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Timer,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Modal,
  Skeleton,
  Spinner,
} from '../../components/common'
import { examAPI } from '../../services/api'
import { formatTime } from '../../utils'

interface ExamData {
  id: string
  title: string
  description: string
  program: string
  level: number
  duration: number
  totalQuestions: number
  passingScore: number
  startDate: string
  endDate: string
  status: string
}

export const ExamDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [exam, setExam] = useState<ExamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** The "the timer starts now" confirmation, before the paper is opened. */
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await examAPI.getExam(id!)
        if (cancelled) return
        setExam(res.data.data)
      } catch (err) {
        if (cancelled) return
        const message =
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
          'This examination could not be loaded.'
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-4 w-28" />
        <Card>
          <div className="mb-4 flex items-start justify-between">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-2/3" />
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((cell) => (
              <Skeleton key={cell} className="h-16 rounded-lg" />
            ))}
          </div>
          <div className="mt-6 space-y-2">
            {[0, 1, 2, 3].map((line) => (
              <Skeleton key={line} className="h-4 w-3/4" />
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Skeleton className="h-11 w-32 rounded-lg" />
          </div>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Spinner className="h-4 w-4 text-indigo-600" />
            Loading the examination…
          </div>
        </Card>
      </div>
    )
  }

  if (error || !exam) {
    return (
      <div className="mx-auto max-w-lg py-12">
        <Card>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Examination unavailable</h2>
            <p className="mt-2 text-sm text-gray-600">{error}</p>
            <Button className="mt-6" onClick={() => navigate('/exams')}>
              Back to examinations
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        to="/exams"
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        All examinations
      </Link>

      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <Badge variant="info">{exam.program || 'General'}</Badge>
          {exam.level ? <Badge>Level {exam.level}</Badge> : <Badge>All levels</Badge>}
        </div>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">{exam.title}</h1>
        <p className="mb-6 text-gray-600">
          {exam.description || 'No description provided.'}
        </p>

        <dl className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <dt className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <FileText className="h-3 w-3" aria-hidden /> Questions
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-gray-900">{exam.totalQuestions}</dd>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <dt className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <Timer className="h-3 w-3" aria-hidden /> Duration
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-gray-900">
              {formatTime(exam.duration * 60)}
            </dd>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <dt className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <CheckCircle2 className="h-3 w-3" aria-hidden /> Pass mark
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-gray-900">{exam.passingScore}%</dd>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <dt className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <GraduationCap className="h-3 w-3" aria-hidden /> Level
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-gray-900">
              {exam.level || 'All'}
            </dd>
          </div>
        </dl>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Before you start
          </h4>
          <ul className="space-y-1 text-sm text-amber-700">
            <li>The timer starts immediately and cannot be paused.</li>
            <li>Your answers are saved as you go, but the paper cannot be restarted.</li>
            <li>Keep this tab open — switching away may be flagged as suspicious activity.</li>
            <li>You confirm before anything is finally submitted.</li>
          </ul>
        </div>

        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={() => setConfirmOpen(true)}>
            Start examination
          </Button>
        </div>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        icon={<ClipboardCheck className="h-6 w-6" aria-hidden />}
        title="Start the examination?"
        description={`${exam.totalQuestions} questions · ${formatTime(exam.duration * 60)} minutes. The timer begins as soon as you start.`}
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className="w-full sm:w-auto"
            >
              Not yet
            </Button>
            <Button
              onClick={() => navigate(`/exam/${exam.id}/take`)}
              className="w-full sm:w-auto"
            >
              Start now
            </Button>
          </>
        }
      />
    </div>
  )
}
