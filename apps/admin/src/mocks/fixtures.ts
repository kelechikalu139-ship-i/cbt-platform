import type {
  AuditAction,
  AuditLog,
  Category,
  EntityStatus,
  Exam,
  ExamSession,
  Permission,
  Question,
  Result,
  Role,
  Student,
  Subject,
  User,
} from '../types'
import { ROLE_LABELS } from '../types'
import { gradeFor, makeRng } from '../utils'

/**
 * UI-only fixture data.
 *
 * Nothing here is imported by production services. `src/services/admin.api.ts`
 * selects between the real API and these fixtures so that removing this
 * directory is the only change needed once the Node backend is running.
 *
 * The dataset is generated once at module load from a fixed seed so figures
 * stay stable across hot reloads and screenshots.
 */

const rng = makeRng(20260101)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]
const between = (min: number, max: number): number => Math.floor(rng() * (max - min + 1)) + min

/** Fixed "now" so derived counts (today's exams, uptime) stay meaningful. */
const NOW = new Date('2026-09-30T09:30:00.000Z')
const HOUR = 3600_000
const DAY = 24 * HOUR

const iso = (d: Date): string => d.toISOString()
const daysFromNow = (n: number, hours = 0): string => iso(new Date(NOW.getTime() + n * DAY + hours * HOUR))
const hoursFromNow = (n: number): string => iso(new Date(NOW.getTime() + n * HOUR))

/* -------------------------------------------------------------------------- */
/* Categories and subjects                                                     */
/* -------------------------------------------------------------------------- */

export const categories: Category[] = [
  ['cat-nursing', 'Nursing', 'Clinical and professional nursing education.'],
  ['cat-midwifery', 'Midwifery', 'Midwifery and maternal health practice.'],
  ['cat-science', 'Basic Sciences', 'Foundational science subjects.'],
  ['cat-general', 'General Studies', 'General education and common papers.'],
  ['cat-computing', 'Computing', 'Computer studies and information technology.'],
  ['cat-health', 'Public Health', 'Community health, epidemiology and biostatistics.'],
].map(([id, name, description], i) => ({
  id: id!,
  name: name!,
  description: description!,
  sortOrder: i,
  // Availability is a boolean server-side, not a status enum.
  isActive: i !== 5,
  subjectCount: 0,
  questionCount: 0,
  createdAt: daysFromNow(-320 + i * 7),
  updatedAt: daysFromNow(-30 + i * 3),
}))

export const subjects: Subject[] = [
  ['sub-anatomy', 'cat-nursing', 'Human Anatomy & Physiology', 'NUR101'],
  ['sub-fundamentals', 'cat-nursing', 'Fundamentals of Nursing', 'NUR102'],
  ['sub-pharm', 'cat-nursing', 'Pharmacology', 'NUR201'],
  ['sub-patho', 'cat-nursing', 'Pathophysiology', 'NUR202'],
  ['sub-obstetrics', 'cat-midwifery', 'Obstetrics & Gynaecology', 'MID201'],
  ['sub-neonatology', 'cat-midwifery', 'Neonatal Care', 'MID202'],
  ['sub-biochem', 'cat-science', 'Medical Biochemistry', 'SCI101'],
  ['sub-micro', 'cat-science', 'Medical Microbiology', 'SCI102'],
  ['sub-phys', 'cat-science', 'Medical Physics', 'SCI103'],
  ['sub-english', 'cat-general', 'English Language', 'GEN101'],
  ['sub-ict', 'cat-computing', 'Introduction to ICT', 'CMP101'],
  ['sub-epidemiology', 'cat-health', 'Epidemiology', 'PH201'],
  ['sub-biostat', 'cat-health', 'Biostatistics', 'PH202'],
].map(([id, categoryId, name, code], i) => ({
  id: id!,
  categoryId: categoryId!,
  // Denormalised by the server so the subject table can render a category column
  // without a second request.
  categoryName: categories.find((c) => c.id === categoryId)!.name,
  name: name!,
  code: code!,
  status: i === 5 ? ('INACTIVE' as const) : ('ACTIVE' as const),
  questionCount: 0,
  createdAt: daysFromNow(-300 + i * 6),
  updatedAt: daysFromNow(-20 + i * 2),
}))

/* -------------------------------------------------------------------------- */
/* Students                                                                    */
/* -------------------------------------------------------------------------- */

const FIRST_NAMES = [
  'Adebayo', 'Chinedu', 'Fatima', 'Ibrahim', 'Grace', 'Oluwaseun', 'Amaka', 'Yusuf',
  'Ngozi', 'Emeka', 'Zainab', 'Tunde', 'Halima', 'Segun', 'Bisi', 'Musa',
  'Kemi', 'David', 'Aisha', 'Peter', 'Rukayat', 'Joseph', 'Maryam', 'Daniel',
]

const LAST_NAMES = [
  'Fashola', 'Okonkwo', 'Abdullahi', 'Bello', 'Adeyemi', 'Okafor', 'Ibrahim',
  'Ogunleye', 'Balogun', 'Chukwu', 'Yusuf', 'Eze', 'Mohammed', 'Olawale',
  'Nwachukwu', 'Sanni', 'Ojo', 'Adekunle', 'Lawal', 'Uche',
]

const PROGRAMS = [
  'Nursing', 'Midwifery', 'Medical Laboratory Science', 'Public Health',
  'Radiography', 'Pharmacy', 'Physiotherapy', 'Environmental Health',
]

const CLASS_NAMES = [
  'Nursing I - A', 'Nursing I - B', 'Nursing II - A', 'Nursing II - B',
  'Midwifery I - A', 'Midwifery II - A', 'Medical Lab I - A', 'Public Health I - A',
]

const SESSIONS = ['2025/2026', '2026/2027']

const DEPARTMENTS = ['Clinical Sciences', 'Basic Sciences', 'Public Health']

const STUDENT_COUNT = 1248

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

export const students: Student[] = Array.from({ length: STUDENT_COUNT }, (_, i) => {
  const firstName = FIRST_NAMES[i % FIRST_NAMES.length]!
  const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length]!
  const status = i % 97 === 0 ? 'SUSPENDED' : i % 23 === 0 ? 'INACTIVE' : 'ACTIVE'
  const level = ([100, 100, 200, 200, 300, 400] as const)[i % 6]!
  const program = pick(PROGRAMS)

  return {
    id: `stu-${pad(i + 1, 5)}`,
    studentId: `CBT/${NOW.getUTCFullYear() - (level > 200 ? 3 : level > 100 ? 2 : 1)}/${pad(i + 1, 5)}`,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    email: i % 11 === 0 ? null : `${firstName}.${lastName}${i}@student.school.local`.toLowerCase(),
    // `program` is required server-side; `department` is optional.
    program,
    department: pick(DEPARTMENTS),
    level,
    semester: (i % 2) + 1,
    className: CLASS_NAMES[i % CLASS_NAMES.length]!,
    session: SESSIONS[i % SESSIONS.length]!,
    gender: i % 2 === 0 ? 'Female' : 'Male',
    status,
    hasPortalAccount: i % 4 !== 0,
    hasActiveSession: i % 5 === 0, // ~20% have active sessions
    createdAt: daysFromNow(-between(30, 400)),
    updatedAt: daysFromNow(-between(0, 30)),
  }
})

/* -------------------------------------------------------------------------- */
/* Questions                                                                   */
/* -------------------------------------------------------------------------- */

/** `[question text, options]` */
const QUESTION_STEMS: Array<[string, string[]]> = [
  ['Which chamber of the heart pumps oxygenated blood into systemic circulation?', ['Right atrium', 'Right ventricle', 'Left atrium', 'Left ventricle']],
  ['The mitral valve separates which two structures?', ['Right atrium and right ventricle', 'Left atrium and left ventricle', 'Left ventricle and aorta', 'Pulmonary artery and left atrium']],
  ['How many pairs of ribs does a typical adult have?', ['10', '11', '12', '13']],
  ['Which bone is the largest in the human body?', ['Tibia', 'Femur', 'Humerus', 'Ilium']],
  ['Which electrolyte disturbance is most immediately life-threatening?', ['Mild hyponatraemia', 'Severe hyperkalaemia', 'Mild hypocalcaemia', 'Mild hypomagnesaemia']],
  ['The first stage of the nursing process is:', ['Diagnosis', 'Assessment', 'Implementation', 'Evaluation']],
  ['Hand hygiene is required before and after every patient contact.', ['True', 'False']],
  ['Standard precautions apply to which group of patients?', ['Only known infections', 'All patients regardless of infection status', 'Only immunocompromised patients', 'Only surgical patients']],
  ['Which is the strongest patient identifier?', ['Room number', 'Bed number', 'Full name', 'Hospital registration number']],
  ['The correct sequence before donning gloves is:', ['Perform hand hygiene', 'Apply soap', 'Dry with paper towel', 'Put on gown']],
  ['Which route of administration has the fastest onset?', ['Oral', 'Intramuscular', 'Intravenous', 'Subcutaneous']],
  ['Intramuscular injections are commonly given into:', ['Deltoid and vastus lateralis', 'Rectus abdominis only', 'Gluteus maximus only', 'Any site equally']],
  ['How many drops per mL run through a standard giving set?', ['10', '15', '20', '60']],
  ['Which is a common side effect of NSAIDs?', ['Hypoglycaemia', 'Gastric irritation', 'Polycythaemia', 'Hypercalcaemia']],
  ['Digoxin toxicity classically presents with:', ['Atrial fibrillation', 'Atrial flutter', 'Atrial tachycardia with block', 'Ventricular fibrillation']],
  ['Which vitamin deficiency causes megaloblastic anaemia?', ['Vitamin C', 'Vitamin B12', 'Vitamin K', 'Vitamin D']],
  ['The normal adult resting heart rate range is:', ['20-40 bpm', '60-100 bpm', '120-160 bpm', '180-200 bpm']],
  ['Insulin lowers blood glucose mainly by:', ['Increasing renal excretion', 'Promoting cellular glucose uptake', 'Stimulating glycogenolysis', 'Blocking all carbohydrate absorption']],
  ['An incidence rate describes:', ['Existing cases at a point in time', 'New cases over a period in an at-risk population', 'The proportion of a population that is immune', 'Mortality within 28 days']],
  ['The primary purpose of a control group is to:', ['Increase sample size', 'Provide a baseline for comparison', 'Reduce study cost', 'Ensure ethical approval']],
  ['In statistics, the median is the value that:', ['Has the highest frequency', 'Splits the ordered data in half', 'Equals the arithmetic mean', 'Is always zero']],
  ['Binary representation uses which symbols?', ['0 and 1', '1 and 2', 'A and B', '+ and −']],
  ['A database primary key must be:', ['Editable', 'Unique and non-null', 'Text only', 'Optional']],
  ['HTTP status code 404 indicates:', ['Server error', 'Resource not found', 'Unauthorized', 'Request accepted']],
  ['A firewall primarily controls:', ['Screen brightness', 'Network traffic between hosts', 'Disk usage', 'Printer access']],
]

const EXPLANATIONS = [
  'Recall the standard definition from the course notes.',
  'Consider the physiological rationale before selecting an option.',
  'This is a commonly examined distinction.',
  'Refer to the relevant lecture slide and the clinical guideline.',
]

const QUESTION_COUNT = 5842

/** Option labels are single letters ("A", "B", …), matching the server. */
const optionLabel = (index: number): string => String.fromCharCode(65 + index)

export const questions: Question[] = Array.from({ length: QUESTION_COUNT }, (_, i) => {
  const template = QUESTION_STEMS[i % QUESTION_STEMS.length]!
  const subject = subjects[i % subjects.length]!
  const category = categories.find((c) => c.id === subject.categoryId)!
  const isBoolean = template[1].length === 2 && template[1][0] === 'True'

  // Only the three types the schema actually accepts. `MULTIPLE_ANSWER` was a
  // frontend-only invention with no server counterpart.
  const type: Question['type'] = isBoolean
    ? 'TRUE_FALSE'
    : i % 17 === 0
      ? 'SHORT_ANSWER'
      : 'MULTIPLE_CHOICE'

  const correctIndex = between(0, template[1].length - 1)
  const status = i % 31 === 0 ? 'DRAFT' : i % 137 === 0 ? 'INACTIVE' : 'ACTIVE'

  return {
    id: `que-${pad(i + 1, 6)}`,
    stem:
      i < QUESTION_STEMS.length
        ? template[0]
        : `${template[0]} (variant ${Math.floor(i / QUESTION_STEMS.length) + 1})`,
    type,
    categoryId: category.id,
    categoryName: category.name,
    subjectId: subject.id,
    subjectName: subject.name,
    difficulty: i % 11 === 0 ? 'HARD' : i % 5 === 0 ? 'EASY' : 'MEDIUM',

    // A true/false item carries its meaning in the key, not in two options, so it
    // has no option rows — the schema rejects them.
    options:
      type === 'SHORT_ANSWER' || type === 'TRUE_FALSE'
        ? []
        : template[1].map((text, oi) => ({
            id: `opt-${pad(i + 1, 6)}-${oi}`,
            label: optionLabel(oi),
            text,
            sortOrder: oi,
          })),

    // One key on the question: the option label for objective types, the accepted
    // text for short answer, TRUE/FALSE for boolean items.
    correctAnswer:
      type === 'TRUE_FALSE'
        ? 'TRUE'
        : type === 'SHORT_ANSWER'
          ? template[1][correctIndex]!
          : optionLabel(correctIndex),

    explanation: i % 4 === 0 ? null : pick(EXPLANATIONS)!,
    points: String(i % 9 === 0 ? 2 : 1),
    status,
    tags: i % 3 === 0 ? null : `tag${between(1, 12)},revision`,
    timesUsed: between(0, 6),
    createdAt: daysFromNow(-between(1, 500)),
    updatedAt: daysFromNow(-between(0, 120)),
  }
})

// Backfill the denormalised counts the UI displays.
for (const subject of subjects) {
  subject.questionCount = questions.filter(
    (q) => q.subjectId === subject.id && q.status === 'ACTIVE',
  ).length
}
for (const category of categories) {
  category.questionCount = questions.filter(
    (q) => q.categoryId === category.id && q.status === 'ACTIVE',
  ).length
  category.subjectCount = subjects.filter((s) => s.categoryId === category.id).length
}

/* -------------------------------------------------------------------------- */
/* Exams                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Exam blueprints.
 *
 * There is no `SCHEDULED` status: a paper with a future window is `PUBLISHED`
 * and simply not yet open, and `ONGOING` is assigned by the server once the
 * window opens. Exams here are seeded with the status their window implies.
 */
const EXAM_BLUEPRINTS: Array<{
  title: string
  program: string
  level: number
  questionCount: number
  duration: number
  passPercentage: number
  maxAttempts: number
  status: Exam['status']
  startInDays: number
  endInDays: number
  assigned: number
}> = [
  { title: 'First Semester 2026 — Nursing Fundamentals', program: 'Nursing', level: 100, questionCount: 100, duration: 120, passPercentage: 50, maxAttempts: 2, status: 'ONGOING', startInDays: -3, endInDays: 4, assigned: 100 },
  { title: 'Midwifery Certification — Obstetrics', program: 'Midwifery', level: 200, questionCount: 80, duration: 90, passPercentage: 60, maxAttempts: 1, status: 'ONGOING', startInDays: -1, endInDays: 2, assigned: 80 },
  { title: 'Medical Biochemistry Mock', program: 'Medical Laboratory Science', level: 200, questionCount: 60, duration: 60, passPercentage: 50, maxAttempts: 3, status: 'PUBLISHED', startInDays: 2, endInDays: 20, assigned: 60 },
  { title: 'Introduction to ICT — Continuous Assessment', program: 'Public Health', level: 100, questionCount: 40, duration: 45, passPercentage: 45, maxAttempts: 1, status: 'PUBLISHED', startInDays: 5, endInDays: 30, assigned: 40 },
  { title: 'Public Health Practicum — Epidemiology', program: 'Public Health', level: 300, questionCount: 50, duration: 75, passPercentage: 50, maxAttempts: 2, status: 'PUBLISHED', startInDays: 9, endInDays: 45, assigned: 50 },
  { title: 'Second Semester 2026 — Anatomy & Physiology', program: 'Nursing', level: 200, questionCount: 120, duration: 150, passPercentage: 55, maxAttempts: 2, status: 'DRAFT', startInDays: 30, endInDays: 75, assigned: 0 },
  { title: 'General Studies — English Language', program: 'Nursing', level: 300, questionCount: 45, duration: 60, passPercentage: 40, maxAttempts: 3, status: 'COMPLETED', startInDays: -60, endInDays: -45, assigned: 45 },
  { title: 'Pharmacology Pre-Clinical Assessment', program: 'Nursing', level: 200, questionCount: 90, duration: 100, passPercentage: 55, maxAttempts: 2, status: 'COMPLETED', startInDays: -75, endInDays: -60, assigned: 90 },
  { title: 'Medical Microbiology — Rescheduled', program: 'Medical Laboratory Science', level: 200, questionCount: 55, duration: 65, passPercentage: 50, maxAttempts: 1, status: 'ARCHIVED', startInDays: -140, endInDays: -130, assigned: 0 },
  { title: 'Physics for Health Sciences', program: 'Radiography', level: 200, questionCount: 35, duration: 45, passPercentage: 45, maxAttempts: 2, status: 'DRAFT', startInDays: 45, endInDays: 90, assigned: 0 },
]

export const exams: Exam[] = EXAM_BLUEPRINTS.map((b, i) => {
  const isPublished = b.status !== 'DRAFT'

  return {
    id: `exm-${pad(i + 1, 4)}`,
    title: b.title,
    description: `Assesses ${b.program.toLowerCase()} candidates at level ${b.level}.`,
    instructions: 'Answer every question. You may navigate back and forth before submitting.',
    program: b.program,
    department: null,
    level: b.level,
    semester: 1,
    session: SESSIONS[i % SESSIONS.length]!,
    durationMinutes: b.duration,
    // Decimal columns cross the wire as strings; fixtures must do the same or the
    // mock would hide string-arithmetic bugs that only appear against the real API.
    passPercentage: String(b.passPercentage),
    maxAttempts: b.maxAttempts,
    shuffleQuestions: b.questionCount > 1,
    shuffleOptions: true,
    showResultImmediately: false,
    questionCount: b.questionCount,
    startAt: daysFromNow(b.startInDays),
    endAt: daysFromNow(b.endInDays, 23),
    status: b.status,
    publishedAt: isPublished ? daysFromNow(b.startInDays - 5) : null,
    createdById: 'usr-00002',
    attachedQuestions: b.questionCount,
    sessionCount: b.assigned,
    resultCount: Math.round(b.assigned * 0.82),
    createdAt: daysFromNow(-between(40, 200)),
    updatedAt: daysFromNow(-between(0, 40)),
  }
})

/* -------------------------------------------------------------------------- */
/* Exam sessions                                                               */
/* -------------------------------------------------------------------------- */

const OPEN_EXAMS = exams.filter((e) => e.status === 'ONGOING')

export const examSessions: ExamSession[] = Array.from({ length: 42 }, (_, i) => {
  const exam = OPEN_EXAMS[i % OPEN_EXAMS.length]!
  const student = students[between(0, students.length - 1)]!
  const startedAt = new Date(NOW.getTime() - between(3, 110) * 60_000)
  const expiresAt = new Date(startedAt.getTime() + exam.durationMinutes * 60_000)
  const elapsed = (NOW.getTime() - startedAt.getTime()) / 1000
  const isExpired = elapsed > exam.durationMinutes * 60
  const status = isExpired ? 'EXPIRED' : i % 7 === 0 ? 'ABANDONED' : 'IN_PROGRESS'

  return {
    id: `ses-${pad(i + 1, 6)}`,
    examId: exam.id,
    examName: exam.title,
    studentId: student.id,
    studentId_: student.studentId,
    studentName: student.fullName,
    status,
    startedAt: iso(startedAt),
    expiresAt: iso(expiresAt),
    submittedAt: null,
    currentQuestionIndex: between(0, (exam.questionCount ?? 1) - 1),
    secondsRemaining: Math.max(0, Math.round(exam.durationMinutes * 60 - elapsed)),
    violations: between(0, 2),
    lastSeenAt: hoursFromNow(-between(0, 3)),
  }
})

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

const GRADED_EXAMS = exams.filter((e) => e.status !== 'DRAFT' && e.status !== 'ARCHIVED')

export const results: Result[] = Array.from({ length: 640 }, (_, i) => {
  const exam = GRADED_EXAMS[i % GRADED_EXAMS.length]!
  const student = students[between(0, students.length - 1)]!
  const totalQuestions = Math.min(exam.questionCount ?? 40, between(20, 80))
  const accuracy = 0.45 + rng() * 0.5
  const correctAnswers = Math.round(totalQuestions * accuracy)
  const answeredQuestions = Math.min(
    totalQuestions,
    correctAnswers + between(0, Math.max(1, Math.round(totalQuestions * 0.18))),
  )
  const wrongAnswers = answeredQuestions - correctAnswers
  const unanswered = totalQuestions - answeredQuestions
  const marksPerQuestion = 1
  const marksObtained = correctAnswers * marksPerQuestion
  const totalMarks = totalQuestions * marksPerQuestion
  const percentage = Math.round((marksObtained / totalMarks) * 1000) / 10
  const submittedAt = daysFromNow(-between(0, 80), between(0, 23))

  return {
    id: `res-${pad(i + 1, 7)}`,
    examSessionId: `ses-${pad(between(1, 42), 6)}`,
    examId: exam.id,
    examName: exam.title,
    studentId: student.id,
    studentId_: student.studentId,
    studentName: student.fullName,
    className: student.className,
    level: student.level,
    totalQuestions,
    answeredQuestions,
    correctAnswers,
    wrongAnswers,
    unansweredQuestions: unanswered,
    totalMarks,
    marksObtained,
    percentage,
    grade: gradeFor(percentage),
    passed: percentage >= Number(exam.passPercentage),
    timeSpentSeconds: between(exam.durationMinutes * 20, exam.durationMinutes * 58) * 60,
    submittedAt,
  }
})

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Role grants, copied verbatim from the server's `role_permissions` join table.
 *
 * This exists only so mock mode renders a believable sidebar. It is documentation
 * of the server's matrix, not a second source of truth: `auth.ts` derives
 * permissions from the signed-in user's own `permissions` array, never from this
 * map. When a role's grants change on the server, this table is the thing to
 * update, and nothing else depends on it.
 */
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: [
    'audit.read', 'categories.create', 'categories.delete', 'categories.read', 'categories.update',
    'exams.create', 'exams.delete', 'exams.publish', 'exams.read', 'exams.update',
    'license.manage', 'license.read',
    'questions.create', 'questions.delete', 'questions.read', 'questions.update',
    'results.export', 'results.read', 'sessions.read',
    'students.create', 'students.delete', 'students.read', 'students.update',
    'system.manage', 'system.read',
    'users.create', 'users.delete', 'users.read', 'users.update',
  ],
  ADMIN: [
    'audit.read', 'categories.create', 'categories.delete', 'categories.read', 'categories.update',
    'exams.create', 'exams.delete', 'exams.publish', 'exams.read', 'exams.update',
    'license.read',
    'questions.create', 'questions.delete', 'questions.read', 'questions.update',
    'results.export', 'results.read', 'sessions.read',
    'students.create', 'students.delete', 'students.read', 'students.update',
    'system.read',
    'users.create', 'users.delete', 'users.read', 'users.update',
  ],
  EXAM_OFFICER: [
    'audit.read', 'categories.read', 'exams.create', 'exams.publish', 'exams.read', 'exams.update',
    'questions.read', 'results.export', 'results.read', 'sessions.read', 'students.read', 'system.read',
  ],
  LECTURER: [
    'categories.read', 'exams.read',
    'questions.create', 'questions.read', 'questions.update',
    'results.read', 'students.read',
  ],
  INVIGILATOR: ['exams.read', 'results.read', 'sessions.read', 'students.read', 'system.read'],
  STUDENT: [],
}

interface UserSeed {
  id: string
  firstName: string
  lastName: string
  email: string
  role: Role
  status: EntityStatus
  lastLoginAt: string | null
  createdDaysAgo: number
  updatedDaysAgo: number
}

const USER_SEEDS: UserSeed[] = [
  { id: 'usr-00001', firstName: 'Olumide', lastName: 'Adeyinka', email: 'admin@school.local', role: 'SUPER_ADMIN', status: 'ACTIVE', lastLoginAt: hoursFromNow(-1), createdDaysAgo: 400, updatedDaysAgo: 2 },
  { id: 'usr-00002', firstName: 'Amina', lastName: 'Yusuf', email: 'a.yusuf@school.local', role: 'ADMIN', status: 'ACTIVE', lastLoginAt: hoursFromNow(-3), createdDaysAgo: 320, updatedDaysAgo: 10 },
  { id: 'usr-00003', firstName: 'Emmanuel', lastName: 'Nwachukwu', email: 'e.nwachukwu@school.local', role: 'EXAM_OFFICER', status: 'ACTIVE', lastLoginAt: hoursFromNow(-8), createdDaysAgo: 240, updatedDaysAgo: 15 },
  { id: 'usr-00004', firstName: 'Femi', lastName: 'Balogun', email: 'f.balogun@school.local', role: 'LECTURER', status: 'ACTIVE', lastLoginAt: daysFromNow(-2), createdDaysAgo: 180, updatedDaysAgo: 20 },
  { id: 'usr-00005', firstName: 'Rabiatu', lastName: 'Salami', email: 'r.salami@school.local', role: 'LECTURER', status: 'ACTIVE', lastLoginAt: hoursFromNow(-5), createdDaysAgo: 150, updatedDaysAgo: 5 },
  { id: 'usr-00006', firstName: 'Tunde', lastName: 'Ogunleye', email: 't.ogunleye@school.local', role: 'INVIGILATOR', status: 'ACTIVE', lastLoginAt: hoursFromNow(-2), createdDaysAgo: 120, updatedDaysAgo: 1 },
  { id: 'usr-00007', firstName: 'Grace', lastName: 'Michael', email: 'g.michael@school.local', role: 'INVIGILATOR', status: 'INACTIVE', lastLoginAt: daysFromNow(-48), createdDaysAgo: 95, updatedDaysAgo: 48 },
  { id: 'usr-00008', firstName: 'Daniel', lastName: 'Okafor', email: 'd.okafor@school.local', role: 'LECTURER', status: 'SUSPENDED', lastLoginAt: daysFromNow(-90), createdDaysAgo: 88, updatedDaysAgo: 60 },
]

export const users: User[] = USER_SEEDS.map((seed) => ({
  id: seed.id,
  email: seed.email,
  firstName: seed.firstName,
  lastName: seed.lastName,
  fullName: `${seed.firstName} ${seed.lastName}`,
  role: seed.role,
  roleName: ROLE_LABELS[seed.role],
  status: seed.status,
  isLocked: seed.status === 'SUSPENDED',
  lastLoginAt: seed.lastLoginAt,
  permissions: ROLE_PERMISSIONS[seed.role] ?? [],
  createdAt: daysFromNow(-seed.createdDaysAgo),
  updatedAt: daysFromNow(-seed.updatedDaysAgo),
}))

/* -------------------------------------------------------------------------- */
/* Audit log                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Audit entries.
 *
 * Actions are the server's SCREAMING_SNAKE identifiers and `entity` is a
 * free-form resource label, exactly as `GET /audit-logs` returns them. The
 * server owns the vocabulary; a template list here is only to give mock mode
 * believable content.
 */
const AUDIT_TEMPLATES: Array<{ action: AuditAction; entity: string; description: string }> = [
  { action: 'CREATE_STUDENT', entity: 'STUDENT', description: 'Added student {student} to {class}' },
  { action: 'UPDATE_STUDENT', entity: 'STUDENT', description: 'Updated student record for {student}' },
  { action: 'DELETE_STUDENT', entity: 'STUDENT', description: 'Deactivated student {student}' },
  { action: 'CREATE_QUESTION', entity: 'QUESTION', description: 'Added a question to {subject}' },
  { action: 'UPDATE_QUESTION', entity: 'QUESTION', description: 'Edited a question in {subject}' },
  { action: 'DELETE_QUESTION', entity: 'QUESTION', description: 'Deleted a question from {subject}' },
  { action: 'CREATE_CATEGORY', entity: 'CATEGORY', description: 'Created category {category}' },
  { action: 'CREATE_EXAM', entity: 'EXAM', description: 'Created exam {exam}' },
  { action: 'UPDATE_EXAM', entity: 'EXAM', description: 'Updated the schedule for {exam}' },
  { action: 'PUBLISH_EXAM', entity: 'EXAM', description: 'Published exam {exam}' },
  { action: 'UNPUBLISH_EXAM', entity: 'EXAM', description: 'Unpublished exam {exam}' },
  { action: 'DELETE_EXAM', entity: 'EXAM', description: 'Deleted exam {exam}' },
  { action: 'LOGIN', entity: 'AUTH', description: 'Signed in' },
  { action: 'LOGOUT', entity: 'AUTH', description: 'Signed out' },
  { action: 'TOKEN_REFRESHED', entity: 'AUTH', description: 'Refreshed an access token' },
  { action: 'LOGIN_FAILED', entity: 'AUTH', description: 'Failed sign-in attempt' },
]

const SUBJECTS_FOR_AUDIT = subjects.filter((s) => s.status === 'ACTIVE')

export const auditLogs: AuditLog[] = Array.from({ length: 180 }, (_, i) => {
  const actor = pick(users)!
  const template = pick(AUDIT_TEMPLATES)!
  const exam = pick(exams)!
  const student = pick(students)!
  const subject = pick(SUBJECTS_FOR_AUDIT)!
  const category = pick(categories)!
  const question = pick(questions)!

  const description = template.description
    .replace('{student}', student.fullName)
    .replace('{class}', student.className ?? 'unassigned')
    .replace('{subject}', subject.name)
    .replace('{exam}', exam.title)
    .replace('{category}', category.name)

  // A handful of failed sign-ins have no actor, because the sign-in never
  // established one. Mirrors the server, where `actorId` is null for a rejected
  // attempt.
  const failed = template.action === 'LOGIN_FAILED'

  return {
    id: `aud-${pad(i + 1, 7)}`,
    actorId: failed ? null : actor.id,
    actorEmail: failed ? null : actor.email,
    actorName: failed ? null : actor.fullName,
    action: template.action,
    entity: template.entity,
    entityId: template.entity === 'EXAM' ? exam.id : question.id,
    description,
    metadata: null,
    ipAddress: `192.168.1.${between(2, 250)}`,
    success: !failed,
    createdAt: hoursFromNow(-between(0, 336)),
  }
}).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

/* -------------------------------------------------------------------------- */
/* System settings, health and license                                         */
/* -------------------------------------------------------------------------- */

export const settings = {
  schoolName: 'Federal College of Health Sciences',
  schoolShortName: 'FCHS',
  logoUrl: null,
  defaultTimezone: 'Africa/Lagos',
  serverPort: 5000,
  backupPath: 'C:\\CBT\\backups',
  backupEnabled: true,
  backupFrequencyHours: 12,
  backupRetentionDays: 30,
  startOnWindowsBoot: true,
  sessionTimeoutMinutes: 30,
  maintenanceMode: false,
}

export const installationId = 'CBT-9F83-2K91-AB73'

/**
 * The LAN address the server would report. Shown to the administrator so they
 * know what students must type into their browser.
 */
export const lan = {
  address: '192.168.1.100',
  port: 5000,
  interfaceName: 'Ethernet',
  internetReachable: false,
}

export const getStudentUrl = (): string => `http://${lan.address}:${lan.port}/student`
export const getAdminUrl = (): string => `http://${lan.address}:${lan.port}/admin`

export const license = {
  plan: 'professional' as const,
  expiresAt: daysFromNow(96),
  studentLimit: 5000,
  studentsInUse: students.filter((s) => s.status === 'ACTIVE').length,
}

export const appName = 'Computer Based Test Platform'
export const appVersion = '1.0.0'
export const appBuildDate = daysFromNow(-9)

/* -------------------------------------------------------------------------- */
/* Derived aggregates for the dashboard                                        */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors the counters `GET /dashboard` computes server-side, including the
 * fields it added (`totalSubjects`, `activeQuestions`, `draftExams`,
 * `totalUsers`). Keeping the mock aligned means the dashboard renders
 * identically in both modes.
 */
export function getDashboardCounters() {
  return {
    totalStudents: students.length,
    activeStudents: students.filter((s) => s.status === 'ACTIVE').length,
    totalQuestions: questions.length,
    activeQuestions: questions.filter((q) => q.status === 'ACTIVE').length,
    totalCategories: categories.length,
    totalSubjects: subjects.length,
    totalExams: exams.length,
    publishedExams: exams.filter((e) => e.status === 'PUBLISHED' || e.status === 'ONGOING').length,
    draftExams: exams.filter((e) => e.status === 'DRAFT').length,
    completedExams: exams.filter((e) => e.status === 'COMPLETED').length,
    totalResults: results.length,
    totalUsers: users.length,
  }
}

/**
 * Seven days of session activity, oldest first.
 *
 * Exactly the three fields `GET /dashboard` returns. `started` counts sessions
 * begun on the day and `submitted` counts those submitted on it — note these are
 * bucketed independently by the server, so a session started late on one day and
 * submitted the next appears in both rows.
 */
export function getRecentActivity(days = 7) {
  const buckets: Array<{ date: string; started: number; submitted: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(NOW.getTime() - i * DAY)
    const key = day.toISOString().slice(0, 10)
    buckets.push({
      date: key,
      started: examSessions.filter((s) => s.startedAt.slice(0, 10) === key).length,
      submitted: examSessions.filter((s) => s.submittedAt?.slice(0, 10) === key).length,
    })
  }
  return buckets
}

export function getSubjectPerformance() {
  return subjects
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => {
      const category = categories.find((c) => c.id === s.categoryId)!
      // Exams no longer carry a subject list, so subject performance is left
      // unattributed rather than guessed. This panel stays empty until the
      // results endpoints land in a later phase.
      const forSubject: Result[] = []
      const passed = forSubject.filter((r) => r.passed).length
      return {
        subjectId: s.id,
        subjectName: s.name,
        categoryName: category.name,
        averageScore: forSubject.length
          ? Math.round((forSubject.reduce((a, r) => a + r.percentage, 0) / forSubject.length) * 10) / 10
          : 0,
        attempts: forSubject.length,
        passRate: forSubject.length ? Math.round((passed / forSubject.length) * 1000) / 10 : 0,
      }
    })
    .filter((s) => s.attempts > 0)
    .sort((a, b) => b.averageScore - a.averageScore)
}

export function getUpcomingExams(limit = 5) {
  return exams
    .filter((e) => e.status === 'PUBLISHED' || e.status === 'ONGOING')
    .filter((e) => e.endAt === null || new Date(e.endAt).getTime() >= NOW.getTime())
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))
    .slice(0, limit)
}

export function getActiveSessions(limit = 8) {
  return examSessions.filter((s) => s.status === 'IN_PROGRESS').slice(0, limit)
}

/** Signed-in fixture for UI development. */
export const currentUser: User = users[0]!
export type { Role }
