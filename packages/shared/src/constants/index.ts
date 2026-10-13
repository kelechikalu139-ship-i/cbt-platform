export const ROLES = {
  STUDENT: 'student',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
} as const

export const QUESTION_TYPES = {
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  SHORT_ANSWER: 'short_answer',
} as const

export const DIFFICULTY_LEVELS = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
} as const

export const EXAM_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const

export const SESSION_STATUS = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  AUTO_SUBMITTED: 'auto_submitted',
  ABANDONED: 'abandoned',
} as const

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const

export const PROGRAMS = [
  'Nursing',
  'Midwifery',
  'Medical Lab Science',
  'Pharmacy',
  'Public Health',
  'Radiography',
] as const

export const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const

export const SESSION_MAX_VIOLATIONS = 5

export const AUTO_SAVE_INTERVAL_MS = 15000

export const EXAM_RULES = {
  MIN_DURATION: 5,
  MAX_DURATION: 480,
  MIN_PASSING_SCORE: 1,
  MAX_PASSING_SCORE: 100,
  MIN_QUESTIONS: 5,
  MAX_QUESTIONS: 200,
}

export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  ISSUER: 'cbt-platform',
} as const

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
} as const

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const
