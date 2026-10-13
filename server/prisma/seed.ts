/**
 * Development seed.
 *
 * Creates the RBAC matrix, a development administrator, and a small amount of
 * sample taxonomy and questions so the admin UI has something real to render.
 *
 * Idempotent: running it repeatedly converges on the same state rather than
 * duplicating rows, so it is safe to run after every pull.
 *
 * Credentials (§39, §57)
 * ---------------------
 * The development administrator is created only when `SEED_ADMIN_EMAIL` and
 * `SEED_ADMIN_PASSWORD` are present, and the seed refuses outright when
 * `NODE_ENV=production`. Production credentials are created by the first-run
 * setup wizard, never by this file, so no known credential can ever reach a real
 * installation.
 */
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import bcrypt from 'bcrypt'
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_DESCRIPTIONS,
  ROLE_CODES,
  ROLE_DEFINITIONS,
} from '../src/constants/permissions.js'

const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  BCRYPT_SALT_ROUNDS: Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL ?? '',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD ?? '',
  SEED_ADMIN_FIRST_NAME: process.env.SEED_ADMIN_FIRST_NAME ?? 'System',
  SEED_ADMIN_LAST_NAME: process.env.SEED_ADMIN_LAST_NAME ?? 'Administrator',
  SEED_STUDENT_PASSWORD: process.env.SEED_STUDENT_PASSWORD ?? '',
}

// Load .env for standalone `npm run prisma:seed` invocation.
// Runs unconditionally: a deployment that already exports
// DATABASE_URL keeps it (dotenv never overrides the live
// environment), while the seed-only variables still arrive.
const { default: dotenv } = await import('dotenv')
dotenv.config()

if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed production. Create the first administrator through the setup wizard.')
  process.exit(1)
}

const url = new URL(process.env.DATABASE_URL ?? '')
const adapter = new PrismaMariaDb({
  host: url.hostname || '127.0.0.1',
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  connectionLimit: 5,
  prepareCacheLength: 0,
})

const prisma = new PrismaClient({ adapter })

async function seedPermissions(): Promise<Map<string, string>> {
  const ids = new Map<string, string>()

  for (const key of ALL_PERMISSION_KEYS) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: {
        description: PERMISSION_DESCRIPTIONS[key],
        resource: key.split('.')[0] ?? 'system',
      },
      create: {
        key,
        description: PERMISSION_DESCRIPTIONS[key],
        resource: key.split('.')[0] ?? 'system',
      },
      select: { id: true },
    })

    ids.set(key, permission.id)
  }

  console.log(`  permissions: ${ids.size}`)
  return ids
}

async function seedRoles(permissionIds: Map<string, string>): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>()

  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: definition.code },
      update: { name: definition.name, description: definition.description },
      create: {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystem: definition.isSystem,
      },
      select: { id: true },
    })

    roleIds.set(definition.code, role.id)

    // Replace the grant set so removing a permission from the definition actually
    // takes effect, instead of accumulating stale rows.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })

    if (definition.permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: definition.permissions
          .map((key) => permissionIds.get(key))
          .filter((id): id is string => Boolean(id))
          .map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      })
    }

    console.log(`  role ${definition.code.padEnd(13)} ${definition.permissions.length} permission(s)`)
  }

  return roleIds
}

async function seedSuperAdmin(roleIds: Map<string, string>): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD ?? ''
  const roleId = roleIds.get('SUPER_ADMIN')

  if (!roleId) throw new Error('SUPER_ADMIN role missing after seeding roles')

  if (!email || !password) {
    console.log('  admin: skipped (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set)')
    return
  }

  if (password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters')
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS)

  await prisma.user.upsert({
    where: { email },
    // The password is reset on every seed run so a developer who changed it can
    // always get back to the documented credentials.
    update: {
      passwordHash,
      firstName: process.env.SEED_ADMIN_FIRST_NAME ?? 'System',
      lastName: process.env.SEED_ADMIN_LAST_NAME ?? 'Administrator',
      status: 'ACTIVE',
      deletedAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      roleId,
    },
    create: {
      email,
      passwordHash,
      firstName: process.env.SEED_ADMIN_FIRST_NAME ?? 'System',
      lastName: process.env.SEED_ADMIN_LAST_NAME ?? 'Administrator',
      status: 'ACTIVE',
      roleId,
    },
  })

  console.log(`  admin: ${email}`)
  console.log('  >>> DEVELOPMENT CREDENTIALS. Do not use these on a real deployment.')
}

async function seedSampleContent(): Promise<void> {
  const categorySeeds = [
    { name: 'Mathematics', description: 'Numeric and algebraic reasoning.' },
    { name: 'English Language', description: 'Comprehension and grammar.' },
    { name: 'Basic Science', description: 'Physics, chemistry and biology.' },
  ]

  const categoryIds = new Map<string, string>()

  for (const seed of categorySeeds) {
    const category = await prisma.category.upsert({
      where: { name: seed.name },
      update: { description: seed.description },
      create: { name: seed.name, description: seed.description, sortOrder: categorySeeds.indexOf(seed) },
      select: { id: true },
    })
    categoryIds.set(seed.name, category.id)
  }

  const subjectSeeds = [
    { name: 'Algebra', code: 'MATH-ALG', category: 'Mathematics' },
    { name: 'Geometry', code: 'MATH-GEO', category: 'Mathematics' },
    { name: 'Comprehension', code: 'ENG-COM', category: 'English Language' },
    { name: 'Physics', code: 'SCI-PHY', category: 'Basic Science' },
  ]

  const subjectIds = new Map<string, string>()

  for (const seed of subjectSeeds) {
    const categoryId = categoryIds.get(seed.category)!
    const existing = await prisma.subject.findUnique({ where: { code: seed.code }, select: { id: true } })
    if (existing) {
      subjectIds.set(seed.code, existing.id)
      continue
    }
    const subject = await prisma.subject.create({
      data: { name: seed.name, code: seed.code, categoryId },
      select: { id: true },
    })
    subjectIds.set(seed.code, subject.id)
  }

  // Two objective questions per subject, created only when the subject has none.
  const questionTemplates: Record<string, Array<{ stem: string; options: string[]; answer: string; explanation: string }>> = {
    'MATH-ALG': [
      {
        stem: 'Solve for x: 3x + 9 = 24',
        options: ['x = 3', 'x = 5', 'x = 7', 'x = 9'],
        answer: 'B',
        explanation: 'Subtract 9 to get 3x = 15, then divide by 3 to get x = 5.',
      },
      {
        stem: 'What is the value of (2 + 3) × 4 − 6?',
        options: ['14', '20', '26', '30'],
        answer: 'B',
        explanation: '(2 + 3) × 4 = 20, and 20 − 6 = 14. Order of operations matters.',
      },
    ],
    'MATH-GEO': [
      {
        stem: 'A triangle has angles of 40° and 75°. What is the third angle?',
        options: ['55°', '65°', '75°', '85°'],
        answer: 'B',
        explanation: 'Angles in a triangle sum to 180°, so 180 − 40 − 75 = 65°.',
      },
      {
        stem: 'What is the area of a circle with radius 7 cm? (Take π = 22/7)',
        options: ['154 cm²', '144 cm²', '176 cm²', '198 cm²'],
        answer: 'A',
        explanation: 'Area = π × 7² = 22/7 × 49 = 154 cm².',
      },
    ],
    'ENG-COM': [
      {
        stem: 'Choose the word closest in meaning to "concise".',
        options: ['Brief', 'Verbose', 'Uncertain', 'Decorative'],
        answer: 'A',
        explanation: 'Concise means giving much information clearly in few words.',
      },
      {
        stem: 'Identify the subject of: "The committee approved the budget."',
        options: ['The committee', 'approved', 'the budget', 'None of these'],
        answer: 'A',
        explanation: 'The subject names who performs the action — the committee.',
      },
    ],
    'SCI-PHY': [
      {
        stem: 'What is the SI unit of force?',
        options: ['Joule', 'Newton', 'Watt', 'Pascal'],
        answer: 'B',
        explanation: 'Force is measured in newtons (N), after Isaac Newton.',
      },
      {
        stem: 'Which quantity is measured in amperes?',
        options: ['Voltage', 'Resistance', 'Current', 'Power'],
        answer: 'C',
        explanation: 'The ampere (A) is the SI base unit of electric current.',
      },
    ],
  }

  let created = 0

  for (const [code, templates] of Object.entries(questionTemplates)) {
    const subjectId = subjectIds.get(code)!
    const categoryId = await prisma.subject
      .findUnique({ where: { id: subjectId }, select: { categoryId: true } })
      .then((row) => row?.categoryId)

    if (!categoryId) continue

    const existing = await prisma.question.count({ where: { subjectId } })
    if (existing > 0) continue

    for (const template of templates) {
      await prisma.question.create({
        data: {
          subjectId,
          categoryId,
          type: 'MULTIPLE_CHOICE',
          stem: template.stem,
          explanation: template.explanation,
          difficulty: 'MEDIUM',
          points: new Prisma.Decimal(1),
          correctAnswer: template.answer,
          status: 'ACTIVE',
          options: {
            create: template.options.map((text, index) => ({
              label: String.fromCharCode(65 + index),
              text,
              sortOrder: index,
            })),
          },
        },
      })
      created += 1
    }
  }

  console.log(`  categories: ${categorySeeds.length}, subjects: ${subjectSeeds.length}, questions: ${created}`)
}

/**
 * Seed candidates and one published paper.
 *
 * Without these the admin dashboard, student roster and exam list are all empty
 * on a fresh install, which makes it impossible to tell a working UI from a
 * broken one. The roster deliberately spans several programmes, levels and class
 * names so the list filters and the class selector have something to narrow.
 *
 * Idempotent: keyed on the admission number, so re-seeding never duplicates or
 * resurrects a soft-deleted row.
 */
async function seedStudentsAndExam(roleIds: Map<string, string>): Promise<void> {
  const roster = [
    { studentId: 'CSC/2024/0001', firstName: 'Adaeze', lastName: 'Okonkwo', program: 'Computer Science', department: 'Science', level: 100, semester: 1, className: 'CSC 100 - A', gender: 'Female' },
    { studentId: 'CSC/2024/0002', firstName: 'Bello', lastName: 'Adesanya', program: 'Computer Science', department: 'Science', level: 100, semester: 1, className: 'CSC 100 - A', gender: 'Male' },
    { studentId: 'CSC/2024/0003', firstName: 'Chidi', lastName: 'Nwachukwu', program: 'Computer Science', department: 'Science', level: 100, semester: 1, className: 'CSC 100 - B', gender: 'Male' },
    { studentId: 'MTH/2024/0101', firstName: 'Amaka', lastName: 'Uche', program: 'Mathematics', department: 'Science', level: 200, semester: 2, className: 'MTH 200 - A', gender: 'Female' },
    { studentId: 'PHY/2024/0201', firstName: 'Emeka', lastName: 'Obi', program: 'Physics', department: 'Science', level: 200, semester: 2, className: 'PHY 200 - A', gender: 'Male' },
    { studentId: 'ENG/2023/0301', firstName: 'Fatima', lastName: 'Bello', program: 'English', department: 'Arts', level: 300, semester: 1, className: 'ENG 300 - A', gender: 'Female' },
    { studentId: 'CSC/2023/0401', firstName: 'Grace', lastName: 'Ihedioha', program: 'Computer Science', department: 'Science', level: 300, semester: 1, className: 'CSC 300 - A', gender: 'Female' },
    { studentId: 'CSC/2023/0402', firstName: 'Hassan', lastName: 'Yusuf', program: 'Computer Science', department: 'Science', level: 300, semester: 1, className: 'CSC 300 - A', gender: 'Male' },
  ]

  for (const student of roster) {
    await prisma.student.upsert({
      where: { studentId: student.studentId },
      update: {},
      create: {
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        program: student.program,
        department: student.department,
        level: student.level,
        semester: student.semester,
        className: student.className,
        gender: student.gender,
        status: 'ACTIVE',
      },
    })
  }

  // A published paper so the exams list, publish/unpublish controls and the
  // lifecycle badges all have something to render. Questions are attached from
  // the bank with a fixed order rather than a random draw, so the seed is
  // reproducible.
  const superAdmin = roleIds.get(ROLE_CODES.SUPER_ADMIN)
  const admin = await prisma.user.findFirst({
    where: { roleId: superAdmin, deletedAt: null },
    select: { id: true },
  })

  if (admin) {
    const alreadySeeded = await prisma.exam.findFirst({
      where: { title: 'CBT Practice Paper — Introduction to Computing' },
      select: { id: true },
    })

    if (!alreadySeeded) {
      const questions = await prisma.question.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        take: 5,
        select: { id: true },
      })

      await prisma.exam.create({
        data: {
          title: 'CBT Practice Paper — Introduction to Computing',
          description:
            'A short seeded paper for exercising the exam list, lifecycle controls and dashboard counters.',
          instructions:
            'Answer every question. You may navigate back and forth before submitting.',
          createdById: admin.id,
          program: 'Computer Science',
          level: 100,
          semester: 1,
          // Set for one class, so delivery to "the students this
          // exam was set for" is exercisable on a fresh install (§55).
          classes: ['CSC 100 - A'],
          durationMinutes: 30,
          passPercentage: 50,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          questions: {
            create: questions.map((question, position) => ({ questionId: question.id, position })),
          },
        },
      })

      console.log(`  exam: 1 (${questions.length} questions)`)
    }
  }

  console.log(`  students: ${roster.length}`)
}

/**
 * Portal accounts for the candidates the practice paper is set for.
 *
 * A student row alone cannot sign in: the portal needs a
 * `users` account linked through `Student.userId`. The first
 * two roster entries share the class the practice paper
 * targets, so a fresh install can sign in as a student and
 * sit that paper end to end.
 *
 * Gated on `SEED_STUDENT_PASSWORD`, like the administrator
 * credentials, and never run in production.
 */
async function seedStudentPortalAccounts(roleIds: Map<string, string>): Promise<void> {
  // Read from the live environment: `dotenv.config()` has
  // run by the time this executes, and the deployment's
  // own exports must win over the file.
  const password = (process.env.SEED_STUDENT_PASSWORD ?? '').trim()
  if (!password) {
    console.log('  student portal accounts: skipped (SEED_STUDENT_PASSWORD not set)')
    return
  }
  if (password.length < 8) {
    throw new Error('SEED_STUDENT_PASSWORD must be at least 8 characters')
  }

  const studentRoleId = roleIds.get(ROLE_CODES.STUDENT)
  if (!studentRoleId) throw new Error('STUDENT role missing after seeding roles')
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS)

  const accounts = [
    { studentId: 'CSC/2024/0001', email: 'adaeze.okonkwo@cbt.local', firstName: 'Adaeze', lastName: 'Okonkwo' },
    { studentId: 'CSC/2024/0002', email: 'bello.adesanya@cbt.local', firstName: 'Bello', lastName: 'Adesanya' },
    // Deliberately in another class, so delivery to a
    // specific class is verifiable: this candidate must
    // not see the practice paper.
    { studentId: 'CSC/2024/0003', email: 'chidi.nwachukwu@cbt.local', firstName: 'Chidi', lastName: 'Nwachukwu' },
  ]

  for (const account of accounts) {
    const student = await prisma.student.findUnique({
      where: { studentId: account.studentId },
      select: { id: true },
    })
    if (!student) continue

    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { roleId: studentRoleId, status: 'ACTIVE', deletedAt: null },
      create: {
        email: account.email,
        passwordHash,
        firstName: account.firstName,
        lastName: account.lastName,
        status: 'ACTIVE',
        roleId: studentRoleId,
      },
      select: { id: true },
    })

    await prisma.student.update({
      where: { id: student.id },
      data: { userId: user.id },
    })

    console.log(`  portal: ${account.studentId} → ${account.email}`)
  }
}

async function main(): Promise<void> {
  console.log('Seeding CBT database...')
  console.log(`  environment: ${env.NODE_ENV}`)

  const permissionIds = await seedPermissions()
  const roleIds = await seedRoles(permissionIds)
  await seedSuperAdmin(roleIds)
  await seedSampleContent()
  await seedStudentsAndExam(roleIds)
  await seedStudentPortalAccounts(roleIds)

  console.log('Seed complete.')
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })