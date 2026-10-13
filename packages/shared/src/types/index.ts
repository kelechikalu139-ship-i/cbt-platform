export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export type UserRole = 'student' | 'admin' | 'superadmin'

export interface Student {
  id: string
  userId: string
  studentId: string
  program: string
  level: number
  semester: number
  department?: string
  user?: User
}

export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer'

export interface Question {
  id: string
  subject: string
  type: QuestionType
  question: string
  options?: string[]
  correctAnswer: string
  explanation?: string
  points: number
  difficulty: DifficultyLevel
}

export type DifficultyLevel = 'easy' | 'medium' | 'hard'

export type ExamStatus = 'draft' | 'published' | 'ongoing' | 'completed' | 'archived'

export interface Exam {
  id: string
  title: string
  description: string
  instructions?: string
  program: string
  level: number
  duration: number
  passingScore: number
  maxAttempts: number
  shuffleQuestions: boolean
  showResultsImmediately: boolean
  startDate: Date
  endDate: Date
  status: ExamStatus
  questions?: Question[]
}

export type SessionStatus = 'not_started' | 'in_progress' | 'completed' | 'auto_submitted' | 'abandoned'

export interface ExamSession {
  id: string
  examId: string
  studentId: string
  status: SessionStatus
  currentQuestion: number
  answers: Record<string, string>
  flaggedQuestions: string[]
  timeRemaining: number
  startedAt?: Date
  submittedAt?: Date
  score?: number
  totalPoints?: number
  percentage?: number
  passed?: boolean
  violations: number
}

export interface Result {
  id: string
  sessionId: string
  examId: string
  studentId: string
  score: number
  totalPoints: number
  percentage: number
  passed: boolean
  correctAnswers: number
  totalQuestions: number
  timeSpent: number
  submittedAt: Date
}

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded'

export interface Payment {
  id: string
  studentId: string
  examId: string
  amount: number
  currency: string
  status: PaymentStatus
  reference?: string
  paidAt?: Date
  createdAt: Date
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  error?: string
  errors?: Record<string, string[]>
}
