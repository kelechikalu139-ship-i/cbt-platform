export interface User {
  id: string
  matricNumber: string
  name: string
  program: string
  level: number
  role: 'student' | 'admin'
  avatar?: string
}

export interface Student {
  id: string
  userId: string
  matricNumber: string
  name: string
  program: string
  level: number
  semester: number
}

export interface Question {
  id: string
  examId: string
  type: 'multiple_choice' | 'true_false' | 'short_answer'
  question: string
  options?: string[]
  correctAnswer: string
  points: number
  order: number
}

export interface Exam {
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
  status: 'draft' | 'published' | 'ongoing' | 'completed'
}

export interface ExamSession {
  id: string
  examId: string
  studentId: string
  status: 'not_started' | 'in_progress' | 'completed' | 'auto_submitted'
  currentQuestion: number
  answers: Record<string, string>
  timeRemaining: number
  score?: number
  startedAt?: string
  submittedAt?: string
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (matricNumber: string) => Promise<void>
  logout: () => void
}

export interface ApiResponse<T> {
  data?: T
  message?: string
  error?: string
}

export type Theme = 'light' | 'dark'