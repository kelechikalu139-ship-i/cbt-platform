import type { User, Exam, Question, Student } from '../types'

const delay = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms))

const ok = <T>(data: T) => ({ data: { success: true, data } })

export interface MockSession {
  id: string
  examId: string
  matricNumber: string
  status: 'in_progress' | 'completed' | 'auto_submitted'
  currentQuestion: number
  answers: Record<string, string>
  flaggedQuestions: string[]
  timeRemaining: number
  startedAt: string
  submittedAt?: string
  score?: number
  totalPoints?: number
  percentage?: number
  passed?: boolean
}

const PROGRAMS = ['Nursing', 'Midwifery', 'Medical Lab Science', 'Pharmacy', 'Public Health']

const EXAMS: BankExam[] = [
  {
    id: 'exam-001',
    title: 'Anatomy & Physiology Midterm',
    description:
      'Covers the skeletal, muscular, and cardiovascular systems with emphasis on clinical correlations.',
    program: 'Nursing',
    level: 100,
    duration: 30,
    totalQuestions: 5,
    passingScore: 50,
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: '2026-12-31T23:59:59.000Z',
    status: 'published',
    questions: [
      {
        id: 'q-001',
        examId: 'exam-001',
        type: 'multiple_choice',
        question: 'Which chamber of the heart pumps oxygenated blood to systemic circulation?',
        options: ['Right atrium', 'Right ventricle', 'Left atrium', 'Left ventricle'],
        correctAnswer: 'Left ventricle',
        points: 2,
        order: 1,
      },
      {
        id: 'q-002',
        examId: 'exam-001',
        type: 'true_false',
        question: 'The mitral valve separates the left atrium from the left ventricle.',
        correctAnswer: 'True',
        points: 1,
        order: 2,
      },
      {
        id: 'q-003',
        examId: 'exam-001',
        type: 'multiple_choice',
        question: 'How many pairs of ribs does an adult human typically have?',
        options: ['10', '11', '12', '13'],
        correctAnswer: '12',
        points: 1,
        order: 3,
      },
      {
        id: 'q-004',
        examId: 'exam-001',
        type: 'short_answer',
        question: 'Name the largest bone in the human body.',
        correctAnswer: 'Femur',
        points: 2,
        order: 4,
      },
      {
        id: 'q-005',
        examId: 'exam-001',
        type: 'multiple_choice',
        question: 'Which electrolyte disturbance is most immediately life-threatening?',
        options: ['Mild hyponatraemia', 'Severe hyperkalaemia', 'Mild hypocalcaemia', 'Mild hypomagnesaemia'],
        correctAnswer: 'Severe hyperkalaemia',
        points: 2,
        order: 5,
      },
    ],
  },
  {
    id: 'exam-002',
    title: 'Fundamentals of Nursing Practice',
    description: 'Patient safety, infection control, and the nursing process.',
    program: 'Nursing',
    level: 100,
    duration: 45,
    totalQuestions: 5,
    passingScore: 60,
    startDate: '2026-09-15T00:00:00.000Z',
    endDate: '2026-11-30T23:59:59.000Z',
    status: 'published',
    questions: [
      {
        id: 'q-101',
        examId: 'exam-002',
        type: 'multiple_choice',
        question: 'The five stages of the nursing process begin with which step?',
        options: ['Diagnosis', 'Assessment', 'Implementation', 'Evaluation'],
        correctAnswer: 'Assessment',
        points: 2,
        order: 1,
      },
      {
        id: 'q-102',
        examId: 'exam-002',
        type: 'true_false',
        question: 'Hand hygiene is required before and after every patient contact.',
        correctAnswer: 'True',
        points: 1,
        order: 2,
      },
      {
        id: 'q-103',
        examId: 'exam-002',
        type: 'multiple_choice',
        question: 'Standard precautions apply to which group of patients?',
        options: [
          'Only patients with known infections',
          'All patients, regardless of infection status',
          'Only immunocompromised patients',
          'Only surgical patients',
        ],
        correctAnswer: 'All patients, regardless of infection status',
        points: 2,
        order: 3,
      },
      {
        id: 'q-104',
        examId: 'exam-002',
        type: 'short_answer',
        question: 'What is the correct sequence for donning gloves?',
        correctAnswer: 'Clean hands then gloves',
        points: 2,
        order: 4,
      },
      {
        id: 'q-105',
        examId: 'exam-002',
        type: 'multiple_choice',
        question: 'Which identifier is the strongest patient identifier?',
        options: ['Room number', 'Bed number', 'Full name', 'Hospital registration number'],
        correctAnswer: 'Hospital registration number',
        points: 2,
        order: 5,
      },
    ],
  },
  {
    id: 'exam-003',
    title: 'Pharmacology Basics Quiz',
    description: 'Drug administration routes, calculations, and common side effects.',
    program: 'Midwifery',
    level: 200,
    duration: 20,
    totalQuestions: 5,
    passingScore: 50,
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-10-31T23:59:59.000Z',
    status: 'published',
    questions: [
      {
        id: 'q-201',
        examId: 'exam-003',
        type: 'multiple_choice',
        question: 'The fastest route of drug administration is intravenous.',
        options: ['True', 'False'],
        correctAnswer: 'True',
        points: 1,
        order: 1,
      },
      {
        id: 'q-202',
        examId: 'exam-003',
        type: 'true_false',
        question: 'Intramuscular injections are given into the deltoid or vastus lateralis.',
        correctAnswer: 'True',
        points: 1,
        order: 2,
      },
      {
        id: 'q-203',
        examId: 'exam-003',
        type: 'short_answer',
        question: 'How many drops of an IV solution run through a standard giving set per mL?',
        correctAnswer: '20',
        points: 2,
        order: 3,
      },
      {
        id: 'q-204',
        examId: 'exam-003',
        type: 'multiple_choice',
        question: 'Which of these is a common side effect of NSAIDs?',
        options: ['Hypoglycaemia', 'Gastric irritation', 'Polycythaemia', 'Hypercalcaemia'],
        correctAnswer: 'Gastric irritation',
        points: 2,
        order: 4,
      },
      {
        id: 'q-205',
        examId: 'exam-003',
        type: 'multiple_choice',
        question: 'Digoxin toxicity classically causes which arrhythmia?',
        options: ['Atrial fibrillation', 'Atrial flutter', 'Atrial tachycardia with block', 'Ventricular fibrillation'],
        correctAnswer: 'Atrial tachycardia with block',
        points: 2,
        order: 5,
      },
    ],
  },
]

const sessions = new Map<string, MockSession>()

const profileFor = (matricNumber: string) => {
  const seed = [...matricNumber].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return {
    id: `stu-${matricNumber}`,
    userId: `user-${matricNumber}`,
    matricNumber,
    name: `Student ${matricNumber.slice(-4)}`,
    program: PROGRAMS[seed % PROGRAMS.length],
    level: [100, 100, 200, 300][seed % 4],
    semester: (seed % 3) + 1,
  }
}

const gradeSession = (session: MockSession, exam: BankExam) => {
  let score = 0
  const totalPoints = exam.questions.reduce((sum, q) => sum + q.points, 0)

  const answers = exam.questions.map((q) => {
    const given = session.answers[q.id] ?? ''
    const isCorrect = given.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()
    if (isCorrect) score += q.points
    return {
      question: q.question,
      yourAnswer: given || 'Not answered',
      correctAnswer: q.correctAnswer,
      isCorrect,
      points: q.points,
    }
  })

  const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0
  return { score, totalPoints, percentage, passed: percentage >= exam.passingScore, answers }
}

const resultFor = (session: MockSession) => {
  const exam = EXAMS.find((e) => e.id === session.examId)!
  const graded = gradeSession(session, exam)
  return {
    sessionId: session.id,
    examTitle: exam.title,
    passingScore: exam.passingScore,
    duration: `${Math.max(1, Math.round((exam.duration * 60 - session.timeRemaining) / 60))} min`,
    ...graded,
  }
}

type BankExam = Exam & { questions: Question[] }

const toSummary = (exam: BankExam): Exam => ({
  id: exam.id,
  title: exam.title,
  description: exam.description,
  program: exam.program,
  level: exam.level,
  duration: exam.duration,
  totalQuestions: exam.totalQuestions,
  passingScore: exam.passingScore,
  startDate: exam.startDate,
  endDate: exam.endDate,
  status: exam.status,
})

/** Questions sent to the browser must never carry the answer key. */
const toQuestion = ({ correctAnswer: _answerKey, ...question }: Question) => question

const findOrCreateSession = (matricNumber: string, examId: string): MockSession => {
  for (const s of sessions.values()) {
    if (s.examId === examId && s.matricNumber === matricNumber && s.status !== 'completed') return s
  }
  const exam = EXAMS.find((e) => e.id === examId)!
  const id = `sess-${examId}-${matricNumber}-${Date.now()}`
  const session: MockSession = {
    id,
    examId,
    matricNumber,
    status: 'in_progress',
    currentQuestion: 0,
    answers: {},
    flaggedQuestions: [],
    timeRemaining: exam.duration * 60,
    startedAt: new Date().toISOString(),
  }
  sessions.set(id, session)
  return session
}

const currentMatric = () => {
  try {
    return JSON.parse(localStorage.getItem('cbt-app-storage') || '{}')?.state?.user?.matricNumber
  } catch {
    return undefined
  }
}

export const mockAuthAPI = {
  studentLogin: async (matricNumber: string) => {
    await delay(400)
    if (!/^[A-Za-z0-9/-]{3,20}$/.test(matricNumber)) {
      throw { response: { data: { message: 'Invalid matric number' } } }
    }
    const profile = profileFor(matricNumber)
    const user: User = {
      id: profile.userId,
      matricNumber: profile.matricNumber,
      name: profile.name,
      program: profile.program,
      level: profile.level,
      role: 'student',
    }
    return ok({ user, token: `mock-token-${matricNumber}` })
  },
  me: async () => {
    const matricNumber = currentMatric()
    if (!matricNumber) throw { response: { status: 401 } }
    return ok({ user: profileFor(matricNumber) })
  },
  logout: async () => ok({}),
}

export const mockExamAPI = {
  getExams: async () => {
    await delay()
    return ok(EXAMS.map(toSummary))
  },
  getExam: async (id: string) => {
    await delay(200)
    const exam = EXAMS.find((e) => e.id === id)
    if (!exam) throw { response: { data: { message: 'Exam not found' } } }
    return ok(toSummary(exam))
  },
  startSession: async (examId: string) => {
    await delay(500)
    const matricNumber = currentMatric()
    if (!matricNumber) throw { response: { status: 401 } }
    const session = findOrCreateSession(matricNumber, examId)
    const exam = EXAMS.find((e) => e.id === examId)!
    return ok({
      id: session.id,
      exam: { id: exam.id, title: exam.title, duration: exam.duration },
      questions: exam.questions.map(toQuestion),
      answers: session.answers,
      currentQuestion: session.currentQuestion,
      timeRemaining: session.timeRemaining,
      status: session.status,
    })
  },
  saveAnswer: async (sessionId: string, questionId: string, answer: string) => {
    const session = sessions.get(sessionId)
    if (!session) throw { response: { data: { message: 'Session not found' } } }
    session.answers[questionId] = answer
    return ok({})
  },
  submitSession: async (sessionId: string) => {
    await delay(600)
    const session = sessions.get(sessionId)
    if (!session) throw { response: { data: { message: 'Session not found' } } }
    session.status = 'completed'
    session.submittedAt = new Date().toISOString()
    return ok({ sessionId: session.id })
  },
  getResults: async (sessionId: string) => {
    await delay(300)
    const session = sessions.get(sessionId)
    if (!session) throw { response: { data: { message: 'Result not found' } } }
    return ok(resultFor(session))
  },
  getMySessions: async () => {
    await delay()
    const matricNumber = currentMatric()
    if (!matricNumber) return ok([])
    return ok(
      [...sessions.values()]
        .filter((s) => s.matricNumber === matricNumber && s.status === 'completed')
        .map((s) => {
          const result = resultFor(s)
          return {
            id: s.id,
            examId: s.examId,
            examTitle: result.examTitle,
            percentage: result.percentage,
            passed: result.passed,
            submittedAt: s.submittedAt,
          }
        }),
    )
  },
}

export const mockStudentAPI = {
  getProfile: async () => {
    await delay(200)
    const matricNumber = currentMatric()
    if (!matricNumber) throw { response: { status: 401 } }
    return ok(profileFor(matricNumber))
  },
  updateProfile: async (data: Partial<Student>) => {
    await delay(300)
    return ok({ ...profileFor(currentMatric() || ''), ...data })
  },
  getDashboard: async () => {
    await delay()
    const matricNumber = currentMatric()
    const completed = [...sessions.values()].filter(
      (s) => s.matricNumber === matricNumber && s.status === 'completed',
    )
    const graded = completed.map((s) => gradeSession(s, EXAMS.find((e) => e.id === s.examId)!))
    const available = EXAMS.filter((e) => {
      const start = new Date(e.startDate).getTime()
      const end = new Date(e.endDate).getTime()
      return Date.now() >= start && Date.now() <= end
    })
    return ok({
      totalExams: available.length,
      completedExams: graded.length,
      averageScore: graded.length
        ? Math.round(graded.reduce((sum, g) => sum + g.percentage, 0) / graded.length)
        : 0,
      availableExams: available.map(toSummary),
      recentSessions: graded.slice(-5).map((g, i) => ({
        id: completed[i].id,
        examTitle: EXAMS.find((e) => e.id === completed[i].examId)?.title,
        percentage: g.percentage,
        passed: g.passed,
      })),
    })
  },
}

export const mockExams = EXAMS
