import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/config/database.js'
import { hashPassword } from '../src/utils/password.js'
import { ROLE_CODES } from '../src/constants/permissions.js'
import { autoSubmitExpiredSessions } from '../src/services/auto-submit.service.js'

const stamp = Date.now().toString(36)
const PASSWORD = 'AutoSubmitPass1'

let studentUserId: string
let studentId: string
let examId: string
let sessionId: string

beforeAll(async () => {
  const roleIds = new Map<string, string>()
  for (const role of await prisma.role.findMany({ select: { id: true, code: true } })) {
    roleIds.set(role.code, role.id)
  }

  const studentRoleId = roleIds.get(ROLE_CODES.STUDENT)
  if (!studentRoleId) throw new Error('STUDENT role not found in seed')

  const passwordHash = await hashPassword(PASSWORD)

  const user = await prisma.user.create({
    data: {
      email: `autosubmit-${stamp}@cbt.test`,
      passwordHash,
      firstName: 'Auto',
      lastName: 'Submit',
      roleId: studentRoleId,
    },
  })
  studentUserId = user.id

  const student = await prisma.student.create({
    data: {
      studentId: `AUTO-${stamp}`,
      firstName: 'Auto',
      lastName: 'Submit',
      userId: user.id,
      program: 'Computer Science',
      department: 'Science',
      level: 100,
      semester: 1,
      className: 'CSC 100 - A',
      status: 'ACTIVE',
    },
  })
  studentId = student.id

  // Category + subject needed to create questions.
  const category = await prisma.category.create({
    data: {
      name: `Category ${stamp}`,
      description: 'Test category',
    },
  })
  const subject = await prisma.subject.create({
    data: {
      name: `Subject ${stamp}`,
      code: `SUB-${stamp}`,
      categoryId: category.id,
    },
  })

  // Two questions: one MCQ, one TRUE_FALSE.
  const mcq = await prisma.question.create({
    data: {
      categoryId: category.id,
      subjectId: subject.id,
      type: 'MULTIPLE_CHOICE',
      stem: `What is 2 + 2? ${stamp}`,
      correctAnswer: 'B',
      points: 2,
      options: {
        create: [
          { label: 'A', text: '3', sortOrder: 1 },
          { label: 'B', text: '4', sortOrder: 2 },
          { label: 'C', text: '5', sortOrder: 3 },
        ],
      },
    },
  })

  const tf = await prisma.question.create({
    data: {
      categoryId: category.id,
      subjectId: subject.id,
      type: 'TRUE_FALSE',
      stem: `CPOE stands for Computerised Provider Order Entry. ${stamp}`,
      correctAnswer: 'TRUE',
      points: 1,
    },
  })

  const exam = await prisma.exam.create({
    data: {
      title: `Auto Submit Exam ${stamp}`,
      description: 'Test exam for auto-submit',
      createdById: studentUserId,
      program: 'Computer Science',
      department: 'Science',
      level: 100,
      durationMinutes: 60,
      passPercentage: 50,
      maxAttempts: 1,
      status: 'PUBLISHED',
      showResultImmediately: true,
      classes: ['CSC 100 - A'],
    },
  })
  examId = exam.id

  await prisma.examQuestion.createMany({
    data: [
      { examId, questionId: mcq.id, position: 1, points: 2 },
      { examId, questionId: tf.id, position: 2, points: 1 },
    ],
  })

  // Create an IN_PROGRESS session that has already expired.
  const past = new Date(Date.now() - 60_000) // expired 1 minute ago
  const session = await prisma.examSession.create({
    data: {
      examId,
      studentId,
      status: 'IN_PROGRESS',
      startedAt: past,
      expiresAt: past,
      attemptNumber: 1,
      questionOrder: { questions: [mcq.id, tf.id], options: {} },
    },
  })
  sessionId = session.id
})

afterAll(async () => {
  await prisma.result.deleteMany({ where: { sessionId } })
  await prisma.examAnswer.deleteMany({ where: { examSessionId: sessionId } })
  await prisma.examSession.delete({ where: { id: sessionId } })
  await prisma.examQuestion.deleteMany({ where: { examId } })
  await prisma.exam.delete({ where: { id: examId } })
  await prisma.question.deleteMany({
    where: { OR: [
      { stem: { contains: `What is 2 + 2? ${stamp}` } },
      { stem: { contains: `CPOE stands for Computerised Provider Order Entry. ${stamp}` } },
    ] },
  })
  await prisma.questionOption.deleteMany({
    where: { question: { stem: { contains: `What is 2 + 2? ${stamp}` } } },
  })
  await prisma.subject.deleteMany({ where: { code: `SUB-${stamp}` } })
  await prisma.category.deleteMany({ where: { name: `Category ${stamp}` } })
  await prisma.student.delete({ where: { id: studentId } })
  await prisma.user.delete({ where: { id: studentUserId } })
  await prisma.$disconnect()
})

describe('autoSubmitExpiredSessions', () => {
  it('submits expired IN_PROGRESS sessions and grades them', async () => {
    const before = await prisma.examSession.findUnique({ where: { id: sessionId } })
    expect(before?.status).toBe('IN_PROGRESS')

    await autoSubmitExpiredSessions()

    const after = await prisma.examSession.findUnique({ where: { id: sessionId } })
    expect(after?.status).toBe('AUTO_SUBMITTED')
    expect(after?.submittedAt).not.toBeNull()

    const result = await prisma.result.findUnique({ where: { sessionId } })
    expect(result).not.toBeNull()
    expect(result!.totalQuestions).toBe(2)
    expect(result!.studentId).toBe(studentId)

    // No answers were saved, so all answers are unanswered/wrong.
    expect(result!.correctAnswers).toBe(0)
    expect(result!.wrongAnswers).toBe(0)
    expect(result!.unanswered).toBe(2)
    expect(Number(result!.marksObtained)).toBe(0)
  })

  it('does not re-submit an already-submitted session', async () => {
    const before = await prisma.examSession.findUnique({ where: { id: sessionId } })
    expect(before?.status).toBe('AUTO_SUBMITTED')

    await autoSubmitExpiredSessions()

    const after = await prisma.examSession.findUnique({ where: { id: sessionId } })
    expect(after?.status).toBe('AUTO_SUBMITTED')

    // Should not create a duplicate result.
    const results = await prisma.result.count({ where: { sessionId } })
    expect(results).toBe(1)
  })
})
