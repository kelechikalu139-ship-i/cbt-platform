import { describe, expect, it } from 'vitest'
import {
  assertPasswordAcceptable,
  comparePassword,
  hashPassword,
} from '../src/utils/password.js'
import { createQuestionSchema } from '../src/modules/questions/questions.schema.js'
import { createStudentSchema } from '../src/modules/students/students.schema.js'
import { loginSchema } from '../src/modules/auth/auth.schema.js'

/** Password hashing tests (§14). */
describe('password hashing', () => {
  it('produces a verifiable bcrypt hash and never the plaintext', async () => {
    const hash = await hashPassword('Str0ngPassphrase')

    expect(hash).not.toContain('Str0ngPassphrase')
    expect(hash.startsWith('$2')).toBe(true)
    expect(await comparePassword('Str0ngPassphrase', hash)).toBe(true)
    expect(await comparePassword('wrong', hash)).toBe(false)
  })

  it('salts, so the same password hashes differently each time', async () => {
    const a = await hashPassword('Str0ngPassphrase')
    const b = await hashPassword('Str0ngPassphrase')

    expect(a).not.toBe(b)
    expect(await comparePassword('Str0ngPassphrase', a)).toBe(true)
    expect(await comparePassword('Str0ngPassphrase', b)).toBe(true)
  })

  it('fails closed on a missing or malformed hash instead of throwing', async () => {
    expect(await comparePassword('anything', null)).toBe(false)
    expect(await comparePassword('anything', undefined)).toBe(false)
    expect(await comparePassword('anything', '')).toBe(false)
    expect(await comparePassword('anything', 'not-a-bcrypt-hash')).toBe(false)
  })

  it('enforces a minimum strength floor', () => {
    expect(assertPasswordAcceptable('short1')).toMatch(/at least 8/)
    expect(assertPasswordAcceptable('alllettersonly')).toMatch(/letter and one number/)
    expect(assertPasswordAcceptable('12345678')).toMatch(/letter and one number/)
    expect(assertPasswordAcceptable('GoodPass1')).toBeNull()
  })
})

/** Auth schema tests (§13, §17). */
describe('login schema', () => {
  it('trims the identifier', () => {
    const result = loginSchema.parse({ email: '  CSC/2024/0001 ', password: 'x' })
    expect(result.email).toBe('CSC/2024/0001')
  })

  it('accepts an admission number and rejects blank fields', () => {
    // Staff sign in with an email, students with their
    // admission number; both are valid identifiers.
    expect(loginSchema.safeParse({ email: 'CSC/2024/0001', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'staff@cbt.local', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: '', password: 'x' }).success).toBe(false)
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false)
  })
})

/**
 * Question schema tests (§17, §32).
 *
 * The cross-field rules matter most: a question whose answer key does not match
 * any option would be permanently unanswerable.
 */
describe('question schema', () => {
  const base = {
    categoryId: '11111111-1111-4111-8111-111111111111',
    subjectId: '22222222-2222-4222-8222-222222222222',
    stem: 'What is 2 + 2?',
  }

  const multipleChoice = {
    type: 'MULTIPLE_CHOICE' as const,
    ...base,
    correctAnswer: 'B',
    options: [
      { label: 'A', text: 'Three' },
      { label: 'B', text: 'Four' },
    ],
  }

  it('accepts a well-formed multiple-choice question', () => {
    const parsed = createQuestionSchema.parse(multipleChoice)

    // The schema is a discriminated union keyed on `type`, so TypeScript only
    // exposes `options` after narrowing.
    expect(parsed.correctAnswer).toBe('B')
    expect(parsed.type).toBe('MULTIPLE_CHOICE')
    expect(parsed.points).toBe(1)

    if (parsed.type === 'MULTIPLE_CHOICE') {
      expect(parsed.options).toHaveLength(2)
    } else {
      throw new Error('expected a MULTIPLE_CHOICE question')
    }
  })

  it('rejects an answer key that matches no option', () => {
    const result = createQuestionSchema.safeParse({ ...multipleChoice, correctAnswer: 'Z' })
    expect(result.success).toBe(false)
  })

  it('rejects fewer than two options', () => {
    const result = createQuestionSchema.safeParse({
      ...multipleChoice,
      options: [{ label: 'A', text: 'Only one' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate option labels', () => {
    const result = createQuestionSchema.safeParse({
      ...multipleChoice,
      options: [
        { label: 'A', text: 'One' },
        { label: 'A', text: 'Two' },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('accepts true/false without options', () => {
    const result = createQuestionSchema.safeParse({
      type: 'TRUE_FALSE',
      ...base,
      correctAnswer: 'TRUE',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-boolean key on a true/false question', () => {
    const result = createQuestionSchema.safeParse({
      type: 'TRUE_FALSE',
      ...base,
      correctAnswer: 'MAYBE',
    })
    expect(result.success).toBe(false)
  })

  it('rejects zero or negative marks', () => {
    expect(createQuestionSchema.safeParse({ ...multipleChoice, points: 0 }).success).toBe(false)
    expect(createQuestionSchema.safeParse({ ...multipleChoice, points: -1 }).success).toBe(false)
  })

  it('requires a valid category and subject reference', () => {
    expect(createQuestionSchema.safeParse({ ...multipleChoice, categoryId: 'nope' }).success).toBe(false)
    expect(createQuestionSchema.safeParse({ ...multipleChoice, subjectId: 'not-a-uuid' }).success).toBe(
      false,
    )
  })
})

/** Student schema tests (§17). */
describe('student schema', () => {
  const base = {
    studentId: 'CSC/2024/001',
    firstName: 'Ada',
    lastName: 'Okafor',
    program: 'Computer Science',
  }

  it('accepts a student with a slash in the admission number', () => {
    expect(createStudentSchema.safeParse(base).success).toBe(true)
  })

  it('applies level and semester defaults', () => {
    const parsed = createStudentSchema.parse(base)
    expect(parsed.level).toBe(100)
    expect(parsed.semester).toBe(1)
    expect(parsed.status).toBe('ACTIVE')
  })

  it('rejects an admission number with unexpected characters', () => {
    expect(createStudentSchema.safeParse({ ...base, studentId: 'bad id!' }).success).toBe(false)
  })

  it('treats an optional email of empty string as absent', () => {
    expect(createStudentSchema.safeParse({ ...base, email: '' }).success).toBe(true)
  })

  it('requires a programme', () => {
    expect(createStudentSchema.safeParse({ ...base, program: '' }).success).toBe(false)
  })
})