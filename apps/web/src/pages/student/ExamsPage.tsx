import React from 'react'
import { Link } from 'react-router-dom'
import { Card, Badge, Button, EmptyState } from '../../components/common'
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

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await examAPI.getExams({ status: 'published' })
        setExams(res.data.data || [])
      } catch (err) {
        console.error('Failed to load exams', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Exams</h1>
        <p className="text-gray-500 mt-1">Browse and start your available exams</p>
      </div>

      {exams.length === 0 ? (
        <Card>
          <EmptyState
            title="No exams available"
            description="Check back later for new exams"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {exams.map((exam) => (
            <Card key={exam.id} className="hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <Badge variant="info">{exam.program}</Badge>
                <Badge variant={exam.status === 'ongoing' ? 'success' : 'warning'}>
                  {exam.status}
                </Badge>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{exam.title}</h3>
              <p className="text-sm text-gray-500 mb-4">{exam.description}</p>
              <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                <span>{exam.totalQuestions} questions</span>
                <span>•</span>
                <span>{formatTime(exam.duration * 60)}</span>
                <span>•</span>
                <span>Pass: {exam.passingScore}%</span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">Ends {formatDate(exam.endDate)}</p>
                <Link to={`/exam/${exam.id}`}>
                  <Button size="sm">Start Exam</Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}