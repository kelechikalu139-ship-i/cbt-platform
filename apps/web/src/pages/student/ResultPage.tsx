import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Card, Button, Badge, Spinner } from '../../components/common'
import { examAPI } from '../../services/api'

interface ResultData {
  sessionId: string
  examTitle: string
  score: number
  totalPoints: number
  percentage: number
  passed: boolean
  passingScore: number
  duration: string
  answers: Array<{
    question: string
    yourAnswer: string
    correctAnswer: string
    isCorrect: boolean
    points: number
  }>
}

export const ResultPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const [result, setResult] = useState<ResultData | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await examAPI.getResults(id!)
        setResult(res.data.data)
      } catch (err) {
        // The API withholds a paper's result while the instructor has not
        // released it, and answers 403 with the reason.
        const detail = (err as { response?: { data?: { message?: string } } }).response?.data
          ?.message
        setMessage(detail ?? 'Result not found')
        console.error('Failed to load results', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="text-indigo-600" />
      </div>
    )
  }

  if (!result) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-gray-700 font-medium">{message ?? 'Result not found'}</p>
        <Link to="/results" className="text-sm text-indigo-600 hover:underline">
          ← Back to all results
        </Link>
      </div>
    )
  }

  const scoreColor = result.percentage >= 80 ? 'text-green-600' : result.percentage >= 50 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link to="/dashboard" className="text-sm text-indigo-600 hover:underline">
          ← Back to Dashboard
        </Link>
      </div>

      <Card className="text-center">
        <div className="mb-4">
          <Badge variant={result.passed ? 'success' : 'error'} className="text-sm px-4 py-1">
            {result.passed ? 'PASSED' : 'FAILED'}
          </Badge>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{result.examTitle}</h1>
        <p className="text-gray-500 mb-6">Completed in {result.duration}</p>

        <div className="flex items-center justify-center gap-8 mb-6">
          <div>
            <p className="text-sm text-gray-500">Score</p>
            <p className={`text-4xl font-bold ${scoreColor}`}>{result.percentage}%</p>
          </div>
          <div className="border-l border-gray-200 pl-8">
            <p className="text-sm text-gray-500">Points</p>
            <p className="text-4xl font-bold text-gray-900">
              {result.score}/{result.totalPoints}
            </p>
          </div>
          <div className="border-l border-gray-200 pl-8">
            <p className="text-sm text-gray-500">Pass Mark</p>
            <p className="text-4xl font-bold text-gray-900">{result.passingScore}%</p>
          </div>
        </div>

        <div className="w-full max-w-md mx-auto">
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${result.percentage >= 50 ? 'bg-green-500' : 'bg-red-500'}`}
              style={{ width: `${result.percentage}%` }}
            />
          </div>
        </div>
      </Card>

      <Card title="Answer Review">
        <div className="space-y-4">
          {result.answers.map((answer, i) => (
            <div key={i} className="p-4 border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between mb-2">
                <p className="font-medium text-gray-900">Q{i + 1}. {answer.question}</p>
                {answer.isCorrect ? (
                  <Badge variant="success">Correct</Badge>
                ) : (
                  <Badge variant="error">Incorrect</Badge>
                )}
              </div>
              <div className="text-sm space-y-1">
                <p className="text-gray-600">
                  <span className="font-medium">Your answer:</span> {answer.yourAnswer || 'Not answered'}
                </p>
                {!answer.isCorrect && (
                  <p className="text-green-700">
                    <span className="font-medium">Correct answer:</span> {answer.correctAnswer}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="text-center">
        <Link to="/exams">
          <Button>Back to Exams</Button>
        </Link>
      </div>
    </div>
  )
}