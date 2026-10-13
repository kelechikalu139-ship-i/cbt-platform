import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, Button, Badge, Spinner } from '../../components/common'
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
  const [exam, setExam] = useState<ExamData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await examAPI.getExam(id!)
        setExam(res.data.data)
      } catch (err) {
        console.error('Failed to load exam', err)
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

  if (!exam) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Exam not found</p>
        <Link to="/exams" className="text-indigo-600 hover:underline mt-2 inline-block">
          Back to exams
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link to="/exams" className="text-sm text-indigo-600 hover:underline">
        ← Back to exams
      </Link>

      <Card>
        <div className="flex items-start justify-between mb-4">
          <Badge variant="info">{exam.program}</Badge>
          <Badge variant={exam.status === 'ongoing' ? 'success' : 'warning'}>
            {exam.status}
          </Badge>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{exam.title}</h1>
        <p className="text-gray-600 mb-6">{exam.description}</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">Questions</p>
            <p className="text-lg font-semibold text-gray-900">{exam.totalQuestions}</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">Duration</p>
            <p className="text-lg font-semibold text-gray-900">{formatTime(exam.duration * 60)}</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">Pass Score</p>
            <p className="text-lg font-semibold text-gray-900">{exam.passingScore}%</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">Level</p>
            <p className="text-lg font-semibold text-gray-900">{exam.level}</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <h4 className="text-sm font-medium text-amber-800 mb-2">Before you start:</h4>
          <ul className="text-sm text-amber-700 space-y-1">
            <li>• You cannot pause or restart the exam once started</li>
            <li>• The timer will begin immediately upon starting</li>
            <li>• Make sure you have a stable internet connection</li>
            <li>• Switching tabs may be flagged as suspicious activity</li>
          </ul>
        </div>

        <div className="flex justify-end">
          <Link to={`/exam/${id}/take`}>
            <Button size="lg">Start Exam</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}