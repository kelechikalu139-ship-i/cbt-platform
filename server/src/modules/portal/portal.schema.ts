import { z } from 'zod'

/**
 * Student portal schemas (§17, §55).
 *
 * The student app (`apps/web`) consumes its own, deliberately
 * narrow shapes: snake_case question types, option *texts*
 * rather than ids, and no answer key anywhere in a live paper.
 * The DTOs below are those shapes; the service maps the internal
 * models onto them and never leaks `correctAnswer` to a session
 * that is still live (§32).
 */

export const idParamSchema = z.object({
  id: z.string().uuid('Must be a valid identifier'),
})

export const startSessionSchema = z.object({
  examId: z.string().uuid('Must be a valid identifier'),
})

export const saveAnswerSchema = z.object({
  questionId: z.string().uuid('Must be a valid identifier'),
  /**
   * The option text the candidate picked, or the free-text answer.
   * The service resolves the text to the stored option so the
   * answer key can never be derived from a saved response.
   */
  answer: z.string().max(10_000, 'Answer is too long').default(''),
})

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160, 'Name is too long'),
})

/** Question types as the student app renders them. */
export const WEB_QUESTION_TYPES = {
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  SHORT_ANSWER: 'short_answer',
} as const

/** Session statuses as the student app renders them. */
export const WEB_SESSION_STATUS = {
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'completed',
  AUTO_SUBMITTED: 'auto_submitted',
} as const

/** A question offered to a candidate. Never carries the answer key. */
export interface StudentSessionQuestion {
  id: string
  type: 'multiple_choice' | 'true_false' | 'short_answer'
  question: string
  options?: string[]
  points: number
  order: number
}

/** A live or resumed session, as returned by start and get. */
export interface StudentSessionDto {
  id: string
  exam: { id: string; title: string; duration: number }
  questions: StudentSessionQuestion[]
  answers: Record<string, string>
  currentQuestion: number
  timeRemaining: number
  status: 'in_progress' | 'completed' | 'auto_submitted'
}

/** The exam list/detail card the student app renders. */
export interface StudentExamSummary {
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

/** One graded attempt, as listed on the results screen. */
export interface StudentSessionSummary {
  id: string
  examId: string
  examTitle: string
  /**
   * Null when the paper's instructor has not released results
   * (`Exam.showResultImmediately = false`): the attempt is listed,
   * but the score stays hidden until it is switched on.
   */
  percentage: number | null
  passed: boolean | null
  submittedAt?: string
}

/** The graded paper, including the review the candidate may see. */
export interface StudentResultDto {
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

/** The candidate's own record, as the profile screen renders it. */
export interface StudentProfileDto {
  id: string
  userId: string
  matricNumber: string
  name: string
  program: string
  level: number
  semester: number
  className: string | null
  email: string | null
}

/** Landing screen aggregates. */
export interface StudentDashboardDto {
  totalExams: number
  completedExams: number
  averageScore: number
  availableExams: StudentExamSummary[]
  recentSessions: Array<{
    id: string
    examTitle: string
    percentage: number | null
    passed: boolean | null
  }>
}
