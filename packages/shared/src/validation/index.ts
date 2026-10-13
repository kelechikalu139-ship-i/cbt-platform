import { z } from 'zod'

export const emailSchema = z
  .string()
  .email('Invalid email address')
  .min(1, 'Email is required')
  .max(255)

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Must contain at least one number')

export const nameSchema = z
  .string()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name is too long')

export const studentIdSchema = z
  .string()
  .min(3, 'Student ID must be at least 3 characters')
  .max(50)

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
})

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  studentId: studentIdSchema,
  program: z.string().min(1, 'Program is required'),
  level: z.coerce.number().int().min(1).max(8),
  semester: z.coerce.number().int().min(1).max(3).optional(),
})

export const createExamSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(1),
  instructions: z.string().optional(),
  program: z.string().min(1),
  level: z.coerce.number().int().min(1).max(8),
  duration: z.coerce.number().int().min(5).max(480),
  passingScore: z.coerce.number().min(1).max(100),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(1),
  shuffleQuestions: z.boolean().default(true),
  showResultsImmediately: z.boolean().default(false),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  questionIds: z.array(z.string()).min(1),
})

export const saveAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
})

export const createQuestionSchema = z.object({
  subject: z.string().min(1),
  type: z.enum(['multiple_choice', 'true_false', 'short_answer']),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string().min(1),
  explanation: z.string().optional(),
  points: z.coerce.number().min(1).max(100).default(1),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
})

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
})
