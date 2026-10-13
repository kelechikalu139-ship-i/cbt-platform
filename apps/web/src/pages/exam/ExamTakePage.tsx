import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Button, Badge, Spinner } from '../../components/common'
import { examAPI } from '../../services/api'
import { formatTime, cn } from '../../utils'

interface Question {
  id: string
  type: 'multiple_choice' | 'true_false' | 'short_answer'
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

export const ExamTakePage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<SessionData | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentQ, setCurrentQ] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const start = async () => {
      try {
        const res = await examAPI.startSession(id!)
        const data: SessionData = res.data.data
        setSession(data)
        setAnswers(data.answers || {})
        setCurrentQ(data.currentQuestion || 0)
        setTimeLeft(data.timeRemaining || data.exam.duration * 60)
      } catch (err) {
        console.error('Failed to start exam', err)
        navigate('/exams')
      } finally {
        setLoading(false)
      }
    }
    start()
  }, [id, navigate])

  useEffect(() => {
    if (timeLeft <= 0 || !session || session.status !== 'in_progress') return
    const timer = setInterval(() => {
      setTimeLeft((t) => t - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [timeLeft, session])

  const handleAnswer = useCallback(
    async (questionId: string, answer: string) => {
      setAnswers((prev) => ({ ...prev, [questionId]: answer }))
      try {
        await examAPI.saveAnswer(session!.id, questionId, answer)
      } catch (err) {
        console.error('Failed to save answer', err)
      }
    },
    [session],
  )

  const handleSubmit = useCallback(
    async (sessionId: string) => {
      setSubmitting(true)
      try {
        await examAPI.submitSession(sessionId)
        navigate(`/results/${sessionId}`)
      } catch (err) {
        console.error('Failed to submit', err)
      } finally {
        setSubmitting(false)
      }
    },
    [navigate],
  )

  const autoSubmitted = useRef(false)
  useEffect(() => {
    if (timeLeft > 0 || !session || autoSubmitted.current) return
    autoSubmitted.current = true
    handleSubmit(session.id)
  }, [timeLeft, session, handleSubmit])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="text-indigo-600" />
      </div>
    )
  }

  if (!session) return null

  const question = session.questions[currentQ]
  if (!question) return null

  const answered = Object.keys(answers).length
  const isLowTime = timeLeft < 300
  const locked = timeLeft <= 0 || submitting

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4">
        <div>
          <h1 className="font-semibold text-gray-900">{session.exam.title}</h1>
          <p className="text-sm text-gray-500">
            Question {currentQ + 1} of {session.questions.length} • {answered} answered
          </p>
        </div>
        <div
          className={cn(
            'text-2xl font-mono font-bold px-4 py-2 rounded-lg',
            isLowTime ? 'bg-red-50 text-red-700' : 'bg-indigo-50 text-indigo-700',
          )}
        >
          {formatTime(timeLeft)}
        </div>
      </div>

      {locked && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg text-center">
          Time is up. Your answers are being submitted automatically.
        </p>
      )}

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <Badge variant="info">Question {currentQ + 1}</Badge>
          <span className="text-sm text-gray-500">{question.points} pts</span>
        </div>
        <p className="text-lg text-gray-900 mb-6 font-medium">{question.question}</p>

        {question.type === 'multiple_choice' && (
          <div className="space-y-3">
            {question.options?.map((option, i) => (
              <label
                key={i}
                className={cn(
                  'flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors',
                  answers[question.id] === option
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50',
                )}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={option}
                  checked={answers[question.id] === option}
                  onChange={() => handleAnswer(question.id, option)}
                  disabled={locked}
                  className="h-4 w-4 text-indigo-600"
                />
                <span className="text-gray-800">{option}</span>
              </label>
            ))}
          </div>
        )}

        {question.type === 'true_false' && (
          <div className="space-y-3">
            {['True', 'False'].map((option) => (
              <label
                key={option}
                className={cn(
                  'flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors',
                  answers[question.id] === option
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50',
                )}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={option}
                  checked={answers[question.id] === option}
                  onChange={() => handleAnswer(question.id, option)}
                  disabled={locked}
                  className="h-4 w-4 text-indigo-600"
                />
                <span className="text-gray-800">{option}</span>
              </label>
            ))}
          </div>
        )}

        {question.type === 'short_answer' && (
          <textarea
            value={answers[question.id] || ''}
            onChange={(e) => handleAnswer(question.id, e.target.value)}
            rows={4}
            disabled={locked}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
            placeholder="Enter your answer..."
          />
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentQ((q) => Math.max(0, q - 1))}
          disabled={currentQ === 0 || locked}
        >
          ← Previous
        </Button>

        {currentQ < session.questions.length - 1 ? (
          <Button onClick={() => setCurrentQ((q) => q + 1)} disabled={locked}>
            Next →
          </Button>
        ) : (
          <Button variant="danger" onClick={() => handleSubmit(session.id)} loading={submitting} disabled={locked}>
            Submit Exam
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {session.questions.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentQ(i)}
            disabled={locked}
            className={cn(
              'w-10 h-10 rounded-lg text-sm font-medium transition-colors disabled:opacity-50',
              i === currentQ
                ? 'bg-indigo-600 text-white'
                : answers[session.questions[i].id]
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}