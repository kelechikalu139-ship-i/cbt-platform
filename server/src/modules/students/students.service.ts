import { Prisma } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { runInTransaction } from '../../middleware/error.js'
import { ApiError } from '../../utils/api-error.js'
import { hashPassword } from '../../utils/password.js'
import { buildMeta } from '../../utils/pagination.js'
import { AUDIT_ACTIONS, recordAudit } from '../../services/audit.service.js'
import { buildStudentListArgs, bulkDeleteStudentsSchema } from './students.schema.js'
import type {
  BulkDeleteStudentsInput,
  CreateStudentInput,
  StudentListQuery,
  UpdateStudentInput,
} from './students.schema.js'
import type { PaginationMeta } from '../../utils/http-response.js'

/**
 * Student service (§25, §49, §50).
 *
 * A student record and its optional portal login are created together in one
 * transaction: a `Student` row with no `User` is valid, but a `User` with no
 * `Student` would be an orphaned login nobody can use.
 */

const listSelect = {
  id: true,
  studentId: true,
  firstName: true,
  lastName: true,
  email: true,
  program: true,
  department: true,
  level: true,
  semester: true,
  className: true,
  session: true,
  gender: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StudentSelect

export type StudentListItem = Prisma.StudentGetPayload<{ select: typeof listSelect }>

/**
 * The fields `toDto` reads.
 *
 * Structural rather than an exact payload type, so a query that selects extra
 * columns (`deletedAt`, `user`, …) can still be passed straight in.
 */
type StudentRow = {
  id: string
  studentId: string
  firstName: string
  lastName: string
  email: string | null
  program: string
  department: string | null
  level: number
  semester: number
  className: string | null
  session: string | null
  gender: string | null
  status: StudentListItem['status']
  createdAt: Date
  updatedAt: Date
  /** Present when the detail query includes the linked user row. */
  user?: { sessionHash: string | null; sessionExpiresAt: Date | null } | null
}

/** Shape a student row for the API: no internal surrogate fields, no password. */
function toDto(row: StudentRow) {
  const now = new Date()
  const hasActiveSession = Boolean(
    row.user?.sessionHash && row.user?.sessionExpiresAt && row.user.sessionExpiresAt > now,
  )

  return {
    id: row.id,
    studentId: row.studentId,
    fullName: `${row.firstName} ${row.lastName}`,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    program: row.program,
    department: row.department,
    level: row.level,
    semester: row.semester,
    className: row.className,
    session: row.session,
    gender: row.gender,
    status: row.status,
    hasActiveSession,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listStudents(query: StudentListQuery): Promise<{
  data: ReturnType<typeof toDto>[]
  meta: PaginationMeta
}> {
  const args = buildStudentListArgs(query)

  // Count and page are issued concurrently: two round trips overlap instead of
  // queueing behind each other when a whole lab queries at once.
  const [rows, totalItems] = await Promise.all([
    prisma.student.findMany({
      where: args.where,
      skip: args.skip,
      take: args.take,
      orderBy: args.orderBy,
      select: listSelect,
    }),
    prisma.student.count({ where: args.where }),
  ])

  return {
    data: rows.map(toDto),
    meta: buildMeta(totalItems, args.page, args.limit),
  }
}

export async function getStudent(id: string) {
  const student = await prisma.student.findUnique({
    where: { id },
    select: {
      ...listSelect,
      deletedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          lastLoginAt: true,
          sessionHash: true,
          sessionExpiresAt: true,
        },
      },
    },
  })

  if (!student || student.deletedAt !== null) {
    throw ApiError.notFound('Student not found')
  }

  return {
    ...toDto(student),
    // Guaranteed null by the guard above: a soft-deleted student is reported as
    // "not found" rather than returned with a deletion date.
    deletedAt: null,
    hasPortalAccount: student.user !== null,
    portalEmail: student.user?.email ?? null,
    lastLoginAt: student.user?.lastLoginAt?.toISOString() ?? null,
  }
}

export async function createStudent(
  input: CreateStudentInput,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  // A portal login requires a password; refuse the half-configured pair rather
  // than creating an account nobody can sign in to.
  if (input.userEmail && !input.userPassword) {
    throw ApiError.validation('A password is required when creating a portal login', {
      userPassword: ['Required when userEmail is provided'],
    })
  }

  const passwordHash = input.userPassword ? await hashPassword(input.userPassword) : null

  // A portal login by this email may already exist — an earlier record was
  // deleted, or a roster import created the logins before the students. An
  // unlinked login is adopted and refreshed by this student; one already
  // attached to another candidate is a genuine conflict. A staff account
  // (super admin, invigilator, …) is never adopted — that would strip its
  // privileges and lock the administrator out of their own dashboard.
  let adoptableLoginId: string | null = null
  if (input.userEmail) {
    const existingUser = await prisma.user.findFirst({
      where: { email: input.userEmail },
      select: {
        id: true,
        student: { select: { id: true } },
        role: { select: { code: true } },
      },
    })
    if (existingUser?.student) {
      throw ApiError.conflict('A user with this email already exists', {
        userEmail: ['This email is already registered to another account'],
      })
    }
    if (existingUser && existingUser.role.code !== 'STUDENT') {
      throw ApiError.conflict('That email belongs to a staff account', {
        userEmail: ['This email is already used by a staff account. Use a different email for the student portal login.'],
      })
    }
    adoptableLoginId = existingUser?.id ?? null
  }

  // Scalar fields shared by both the create and reactivate paths.
  const commonData = {
    studentId: input.studentId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email || null,
    program: input.program,
    department: input.department || null,
    level: input.level,
    semester: input.semester,
    className: input.className || null,
    session: input.session || null,
    gender: input.gender || null,
    status: input.status,
  }

  const existing = await prisma.student.findUnique({
    where: { studentId: input.studentId },
    select: { id: true, deletedAt: true, userId: true },
  })

  if (existing) {
    if (existing.deletedAt !== null) {
      // A student with this admission number was previously deactivated
      // (soft-deleted via DELETE). Reactivate the record instead of refusing
      // the request — the number was already allocated to this candidate.
      const student = await runInTransaction(async (tx) => {
        const updateData: Prisma.StudentUpdateInput = {
          ...commonData,
          deletedAt: null,
        }

        if (existing.userId) {
          // Re-enable or refresh the existing portal login.
          const userUpdate: Prisma.UserUpdateInput = { status: input.status }
          if (input.userEmail) userUpdate.email = input.userEmail
          if (passwordHash) userUpdate.passwordHash = passwordHash
          await tx.user.update({
            where: { id: existing.userId },
            data: userUpdate,
          })
        } else if (passwordHash && input.userEmail) {
          // No portal login existed — create one for the reactivated student,
          // or adopt the email's existing login when it is still unlinked
          // (a previous record or a roster import left it behind). A staff
          // account is never adopted.
          const existingUser = await tx.user.findFirst({
            where: { email: input.userEmail },
            select: { id: true, student: { select: { id: true } }, role: { select: { code: true } } },
          })
          if (existingUser?.student) {
            throw ApiError.conflict('A user with this email already exists', {
              userEmail: ['This email is already registered to another account'],
            })
          }
          if (existingUser && existingUser.role.code !== 'STUDENT') {
            throw ApiError.conflict('That email belongs to a staff account', {
              userEmail: ['This email is already used by a staff account. Use a different email for the student portal login.'],
            })
          }
          if (existingUser) {
            updateData.user = { connect: { id: existingUser.id } }
            await tx.user.update({
              where: { id: existingUser.id },
              data: {
                passwordHash,
                firstName: input.firstName,
                lastName: input.lastName,
                status: input.status,
                role: { connect: { code: 'STUDENT' } },
              },
            })
          } else {
            updateData.user = {
              create: {
                email: input.userEmail,
                passwordHash,
                firstName: input.firstName,
                lastName: input.lastName,
                status: input.status,
                role: { connect: { code: 'STUDENT' } },
              },
            }
          }
        }

        return tx.student.update({
          where: { id: existing.id },
          data: updateData,
          select: listSelect,
        })
      })

      await recordAudit({
        actorId: context.actorId,
        action: AUDIT_ACTIONS.CREATE_STUDENT,
        entity: 'Student',
        entityId: student.id,
        description: `Reactivated student ${student.studentId} (${student.firstName} ${student.lastName})`,
        metadata: {
          studentId: student.studentId,
          program: student.program,
          reactivated: true,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      })

      return toDto(student)
    }

    // The student is active — genuine conflict, not a stale record.
    throw ApiError.conflict('A student with this student ID already exists', {
      studentId: ['This student ID is already in use by an existing student'],
    })
  }

  // No existing record — create a brand-new student.
  // Built conditionally rather than with `user: undefined`, which Prisma's
  // nested-write typing rejects and which would silently skip the relation.
  const portalAccount: Prisma.UserCreateWithoutStudentInput | undefined = passwordHash
    ? {
        email: input.userEmail!,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: input.status,
        role: { connect: { code: 'STUDENT' } },
      }
    : undefined

  const studentData: Prisma.StudentCreateInput = {
    ...commonData,
  }

  if (adoptableLoginId) {
    // Adopt the orphan login: link it to this student, then refresh its
    // credentials, name and role in the same transaction.
    studentData.user = { connect: { id: adoptableLoginId } }
  } else if (portalAccount) {
    studentData.user = { create: portalAccount }
  }

  const student = await runInTransaction(async (tx) => {
    const created = await tx.student.create({
      data: studentData,
      select: listSelect,
    })

    if (adoptableLoginId) {
      await tx.user.update({
        where: { id: adoptableLoginId },
        data: {
          ...(passwordHash ? { passwordHash } : {}),
          firstName: input.firstName,
          lastName: input.lastName,
          status: input.status,
          role: { connect: { code: 'STUDENT' } },
        },
      })
    }

    return created
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.CREATE_STUDENT,
    entity: 'Student',
    entityId: student.id,
    description: `Created student ${student.studentId} (${student.firstName} ${student.lastName})`,
    metadata: {
      studentId: student.studentId,
      program: student.program,
      portalAccount: Boolean(passwordHash),
      ...(adoptableLoginId ? { adoptedExistingLogin: true } : {}),
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(student)
}

/** Fields the caller is allowed to change, mapped from input to the column. */
function buildStudentUpdateData(input: UpdateStudentInput): Prisma.StudentUpdateInput {
  const data: Prisma.StudentUpdateInput = {}

  if (input.studentId !== undefined) data.studentId = input.studentId
  if (input.firstName !== undefined) data.firstName = input.firstName
  if (input.lastName !== undefined) data.lastName = input.lastName
  if (input.email !== undefined) data.email = input.email || null
  if (input.program !== undefined) data.program = input.program
  if (input.department !== undefined) data.department = input.department || null
  if (input.level !== undefined) data.level = input.level
  if (input.semester !== undefined) data.semester = input.semester
  if (input.className !== undefined) data.className = input.className || null
  if (input.session !== undefined) data.session = input.session || null
  if (input.gender !== undefined) data.gender = input.gender || null
  if (input.status !== undefined) data.status = input.status

  return data
}

export async function updateStudent(
  id: string,
  input: UpdateStudentInput,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.student.findUnique({
    where: { id },
    select: { id: true, studentId: true, deletedAt: true, userId: true },
  })

  if (!existing || existing.deletedAt !== null) {
    throw ApiError.notFound('Student not found')
  }

  // Reassigning an admission number that already belongs to someone else would
  // violate the unique index; catch it as a 409 with a useful message.
  if (input.studentId && input.studentId !== existing.studentId) {
    const clash = await prisma.student.findUnique({
      where: { studentId: input.studentId },
      select: { id: true },
    })
    if (clash) {
      throw ApiError.conflict('A student with this student ID already exists', {
        studentId: ['This student ID is already in use'],
      })
    }
  }

  const data = buildStudentUpdateData(input)

  // Cascade a status change to the portal login so a suspended student
  // cannot sign in, and a reactivated one can. A student without a portal
  // account has no user row to update.
  if (input.status !== undefined && existing.userId) {
    data.user = { update: { status: input.status } }
  }

  const student = await runInTransaction(async (tx) => {
    return tx.student.update({
      where: { id },
      data,
      select: listSelect,
    })
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.UPDATE_STUDENT,
    entity: 'Student',
    entityId: id,
    description: `Updated student ${student.studentId}`,
    // Field names only — never the values, which would include contact details.
    metadata: { fields: Object.keys(input) },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(student)
}

/**
 * Soft-delete a student.
 *
 * Students are referenced by sessions and results, which must remain intact for
 * historical reporting, so the row is hidden from the UI rather than removed.
 */
export async function deleteStudent(
  id: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.student.findUnique({
    where: { id },
    select: { id: true, studentId: true, deletedAt: true },
  })

  if (!existing || existing.deletedAt !== null) {
    throw ApiError.notFound('Student not found')
  }

  // Deactivate the portal login at the same time, otherwise the student could
  // still sign in to a suspended account.
  await runInTransaction(async (tx) => {
    await tx.student.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    })

    await tx.user.updateMany({
      where: { student: { id } },
      data: { status: 'INACTIVE', refreshTokenHash: null },
    })
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.DELETE_STUDENT,
    entity: 'Student',
    entityId: id,
    description: `Deactivated student ${existing.studentId}`,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return { id, deleted: true }
}

/** Distinct classes, for the filter dropdown in the admin UI. */
export async function listClasses(): Promise<string[]> {
  const rows = await prisma.student.findMany({
    where: { className: { not: null }, deletedAt: null },
    distinct: ['className'],
    select: { className: true },
    orderBy: { className: 'asc' },
  })

  return rows.map((row) => row.className).filter((name): name is string => Boolean(name))
}

/** The institution's academic vocabulary, observed from the student register. */
export interface SchoolOptions {
  /** Programmes students are registered under, e.g. "Computer Science". */
  programs: string[]
  /** Departments, e.g. "Health Sciences". */
  departments: string[]
  /** Class names, e.g. "NMR 100 - A". */
  classes: string[]
  /** Academic sessions, e.g. ["2026/2027"]. */
  sessions: string[]
  /** Levels in use, e.g. [100, 200]. */
  levels: number[]
  /** Semesters in use, e.g. [1, 2]. */
  semesters: number[]
}

/**
 * Distinct programmes, departments, classes, levels and semesters.
 *
 * Read from the register rather than a fixed list so the choices offered
 * when setting an examination match what this institution actually runs —
 * a nursing school, a polytechnic and a university all see their own
 * vocabulary — and values a school uses but has not registered yet can
 * still be typed by hand where the UI offers a combobox.
 */
export async function listSchoolOptions(): Promise<SchoolOptions> {
  const students = await prisma.student.findMany({
    where: { deletedAt: null },
    distinct: ['program', 'department', 'className', 'session', 'level', 'semester'],
    select: {
      program: true,
      department: true,
      className: true,
      session: true,
      level: true,
      semester: true,
    },
  })

  const pick = (values: Array<string | null | undefined>): string[] =>
    [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b))
  const numbers = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b)

  return {
    programs: pick(students.map((row) => row.program)),
    departments: pick(students.map((row) => row.department)),
    classes: pick(students.map((row) => row.className)),
    sessions: pick(students.map((row) => row.session)),
    levels: numbers(students.map((row) => row.level)),
    semesters: numbers(students.map((row) => row.semester)),
  }
}

/**
 * Extend a student's active portal session (admin action).
 *
 * Pushes `sessionExpiresAt` forward on the linked user row so the
 * candidate stays signed in longer without being forced to re-authenticate
 * mid-examination. A student with no portal account cannot be extended.
 */
export async function extendStudentSession(
  studentId: string,
  additionalMinutes: number,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, studentId: true, userId: true, deletedAt: true },
  })

  if (!student || student.deletedAt !== null) {
    throw ApiError.notFound('Student not found')
  }

  if (!student.userId) {
    throw ApiError.badRequest('This student does not have a portal account', {
      studentId: ['No portal session to extend'],
    })
  }

  const user = await prisma.user.findUnique({
    where: { id: student.userId },
    select: { id: true, sessionExpiresAt: true, status: true },
  })

  if (!user || user.status !== 'ACTIVE') {
    throw ApiError.badRequest('This student cannot sign in at the moment', {
      studentId: ['Student account is not active'],
    })
  }

  const now = new Date()
  const currentExpiry = user.sessionExpiresAt ?? now
  const base = currentExpiry > now ? currentExpiry : now
  const sessionExpiresAt = new Date(base.getTime() + additionalMinutes * 60_000)

  await prisma.user.update({
    where: { id: student.userId },
    data: { sessionExpiresAt },
  })

  await recordAudit({
    actorId: context.actorId,
    action: 'EXTEND_STUDENT_SESSION',
    entity: 'Student',
    entityId: studentId,
    description: `Extended portal session for ${student.studentId} by ${additionalMinutes} minute(s)`,
    metadata: { studentId: student.studentId, additionalMinutes },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return { success: true, sessionExpiresAt: sessionExpiresAt.toISOString() }
}

/**
 * End a student's active session (admin action).
 *
 * Clears the sessionHash and sessionExpiresAt on the linked user row,
 * which immediately invalidates the student's access tokens and forces
 * them to sign in again.
 */
export async function logoutStudent(
  studentId: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, studentId: true, userId: true, deletedAt: true },
  })

  if (!student || student.deletedAt !== null) {
    throw ApiError.notFound('Student not found')
  }

  if (!student.userId) {
    throw ApiError.badRequest('This student does not have a portal account', {
      studentId: ['No portal account to sign out'],
    })
  }

  await prisma.user.update({
    where: { id: student.userId },
    data: { sessionHash: null, sessionExpiresAt: null, refreshTokenHash: null },
  })

  await recordAudit({
    actorId: context.actorId,
    action: 'LOGOUT_STUDENT',
    entity: 'Student',
    entityId: studentId,
    description: `Administrator ended session for ${student.studentId}`,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return { success: true }
}

/**
 * Soft-delete every student matching a class or an examination.
 *
 * When `examId` is given, every candidate who has an ExamSession for that
 * paper is deactivated — their results and sessions stay intact for
 * reporting, but the student row is hidden from the register. When
 * `className` is given, every student in that class is deactivated. Both
 * filters may be supplied at once; the intersection is deleted.
 *
 * Portal logins are deactivated alongside so no one can sign in as a
 * removed candidate.
 */
export async function deleteStudentsByFilter(
  input: BulkDeleteStudentsInput,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<{ deleted: number }> {
  const parsed = bulkDeleteStudentsSchema.parse(input)

  const where: Prisma.StudentWhereInput = { deletedAt: null }

  if (parsed.className) {
    where.className = parsed.className
  }

  if (parsed.examId) {
    const sessionStudentIds = await prisma.examSession.findMany({
      where: { examId: parsed.examId },
      select: { studentId: true },
      distinct: ['studentId'],
    })
    if (sessionStudentIds.length === 0) {
      return { deleted: 0 }
    }
    where.id = { in: sessionStudentIds.map((row) => row.studentId) }
  }

  const students = await prisma.student.findMany({
    where,
    select: { id: true, studentId: true, firstName: true, lastName: true, userId: true },
  })

  if (students.length === 0) {
    return { deleted: 0 }
  }

  const ids = students.map((row) => row.id)

  await runInTransaction(async (tx) => {
    await tx.student.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    })

    await tx.user.updateMany({
      where: { student: { id: { in: ids } } },
      data: { status: 'INACTIVE', refreshTokenHash: null },
    })
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.DELETE_STUDENT,
    entity: 'Student',
    entityId: ids[0],
    description: `Deactivated ${students.length} student(s)${parsed.className ? ` in class "${parsed.className}"` : ''}${parsed.examId ? ` for exam ${parsed.examId}` : ''}`,
    metadata: {
      filter: parsed,
      count: students.length,
      studentIds: ids,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return { deleted: students.length }
}