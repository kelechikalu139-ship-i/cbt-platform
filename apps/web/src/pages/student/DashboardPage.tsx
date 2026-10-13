import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Badge, Button, EmptyState } from '../../components/common'
import { studentAPI } from '../../services/api'
import { useAuth } from '../../store'
import type { Exam } from '../../types'
import { formatDate } from '../../utils'

interface DashboardData {
  totalExams: number
  completedExams: number
  averageScore: number
  availableExams: Exam[]
  recentSessions: Array<{
    id: string
    examTitle: string
    /** Null while the instructor withholds results for that paper. */
    percentage: number | null
    passed: boolean | null
  }>
}

export const DashboardPage: React.FC = () => {
  const { user } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await studentAPI.getDashboard()
        setData(res.data.data)
      } catch (err) {
        console.error('Failed to load dashboard', err)
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

  const stats = [
    {
      label: 'Available Exams',
      value: data?.totalExams ?? 0,
      icon: (
        <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      iconBg: 'bg-indigo-50',
    },
    {
      label: 'Completed',
      value: data?.completedExams ?? 0,
      icon: (
        <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      iconBg: 'bg-green-50',
    },
    {
      label: 'Average Score',
      value: `${data?.averageScore ?? 0}%`,
      icon: (
        <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4" />
        </svg>
      ),
      iconBg: 'bg-amber-50',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Welcome back, {user?.name}! Here's your overview
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${stat.iconBg}`}>
                {stat.icon}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card
        title="Available Exams"
        action={<Badge variant="info">{data?.availableExams.length ?? 0} exams</Badge>}
      >
        {!data?.availableExams.length ? (
          <EmptyState
            title="No exams available"
            description="Your administrator has not assigned any exams to you yet"
          />
        ) : (
          <div className="space-y-3">
            {data.availableExams.map((exam) => (
              <div
                key={exam.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-900">{exam.title}</h4>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {exam.program} • Level {exam.level} • {exam.totalQuestions} questions •{' '}
                    {exam.duration} min
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Ends {formatDate(exam.endDate)}</p>
                </div>
                <Link to={`/exam/${exam.id}`} className="ml-4 shrink-0">
                  <Button size="sm">Start</Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent Results">
        {!data?.recentSessions.length ? (
          <EmptyState
            title="No completed exams yet"
            description="Your scores will appear here after you complete an exam"
          />
        ) : (
          <div className="space-y-3">
            {data.recentSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="min-w-0">
                  <h4 className="font-medium text-gray-900 truncate">{session.examTitle}</h4>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  {session.percentage === null ? (
                    <Badge variant="info">Withheld</Badge>
                  ) : (
                    <>
                      <Badge variant={session.passed ? 'success' : 'error'}>
                        {session.passed ? 'Passed' : 'Failed'}
                      </Badge>
                      <span className="font-semibold text-gray-900">{session.percentage}%</span>
                    </>
                  )}
                  <Link
                    to={`/results/${session.id}`}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    Review
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}