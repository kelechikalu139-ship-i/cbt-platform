import React from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, Timer } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ExamCardSkeleton,
} from '../../components/common'
import { examAPI } from '../../services/api'
import { formatTime, formatDate } from '../../utils'

interface ExamItem {
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

export const ExamsPage: React.FC = () => {
  const [exams, setExams] = React.useState<ExamItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await examAPI.getExams({ status: 'published' })
        if (cancelled) return
        setExams(res.data.data || [])
      } catch (err) {
        if (cancelled) return
        const message =
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
          'Your examinations could not be loaded.'
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Examinations</h1>
          <p className="mt-1 text-gray-500">Browse and start the papers set for your class</p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[0, 1, 2, 3].map((card) => (
            <ExamCardSkeleton key={card} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Examinations</h1>
        <p className="mt-1 text-gray-500">Browse and start the papers set for your class</p>
      </div>

      {error ? (
        <Card>
          <div className="flex flex-col items-center py-8 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Could not load examinations</h3>
            <p className="mt-2 max-w-md text-sm text-gray-600">{error}</p>
            <Button className="mt-5" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        </Card>
      ) : exams.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No examinations available"
            description="Papers set for your class will appear here. Check back later or contact your department."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {exams.map((exam) => {
            const closingSoon = Boolean(
              exam.endDate && new Date(exam.endDate).getTime() - Date.now() < 24 * 60 * 60 * 1000,
            )
            return (
              <Card key={exam.id} className="transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <Badge variant="info">{exam.program || 'General'}</Badge>
                  {exam.level ? <Badge>Level {exam.level}</Badge> : <Badge>All levels</Badge>}
                </div>
                <h3 className="mb-1 text-lg font-semibold text-gray-900">{exam.title}</h3>
                <p className="mb-4 line-clamp-2 text-sm text-gray-500">
                  {exam.description || 'No description provided.'}
                </p>

                <dl className="mb-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <dt className="flex items-center gap-1 text-xs text-gray-500">
                      <FileText className="h-3 w-3" aria-hidden /> Questions
                    </dt>
                    <dd className="text-sm font-semibold text-gray-900">{exam.totalQuestions}</dd>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <dt className="flex items-center gap-1 text-xs text-gray-500">
                      <Timer className="h-3 w-3" aria-hidden /> Duration
                    </dt>
                    <dd className="text-sm font-semibold text-gray-900">
                      {formatTime(exam.duration * 60)}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <dt className="flex items-center gap-1 text-xs text-gray-500">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> Pass mark
                    </dt>
                    <dd className="text-sm font-semibold text-gray-900">{exam.passingScore}%</dd>
                  </div>
                </dl>

                <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p
                    className={cnFooter(exam.endDate, closingSoon)}
                    title="Closes"
                  >
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                    {exam.endDate ? `Closes ${formatDate(exam.endDate)}` : 'No closing date'}
                  </p>
                  <Link to={`/exam/${exam.id}`}>
                    <Button size="sm">Start</Button>
                  </Link>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function cnFooter(endDate: string, closingSoon: boolean): string {
  const base = 'flex items-center gap-1.5 text-xs'
  if (!endDate) return `${base} text-gray-400`
  return `${base} ${closingSoon ? 'font-medium text-amber-600' : 'text-gray-400'}`
}
