import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Badge, EmptyState } from '../../components/common'
import { examAPI } from '../../services/api'
import { formatDateTime } from '../../utils'

interface SessionSummary {
  id: string
  examId: string
  examTitle: string
  /** Null while the instructor withholds results for that paper. */
  percentage: number | null
  passed: boolean | null
  submittedAt?: string
}

export const ResultsPage: React.FC = () => {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await examAPI.getMySessions()
        setSessions(res.data.data || [])
      } catch (err) {
        console.error('Failed to load results', err)
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
        <h1 className="text-2xl font-bold text-gray-900">Results</h1>
        <p className="text-gray-500 mt-1">View your exam history and scores</p>
      </div>

      <Card>
        {sessions.length === 0 ? (
          <EmptyState
            title="No results yet"
            description="Complete an exam to see your results here"
          />
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div>
                  <h4 className="font-medium text-gray-900">{session.examTitle}</h4>
                  <p className="text-sm text-gray-500">
                    {session.submittedAt && formatDateTime(session.submittedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {session.percentage === null ? (
                    <Badge variant="info">Score withheld</Badge>
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