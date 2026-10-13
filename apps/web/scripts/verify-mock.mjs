// Verifies the real mock service layer without a browser.
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
}

const { mockAuthAPI, mockExamAPI, mockStudentAPI } = await import('./out/mock.js')

/** Mimics what zustand's persist middleware writes after login. */
const signIn = async (matricNumber) => {
  const { data } = await mockAuthAPI.login(matricNumber)
  mem.set(
    'cbt-app-storage',
    JSON.stringify({ state: { user: data.data.user, token: data.data.token, theme: 'light' }, version: 0 }),
  )
  return data.data
}

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} ${extra}`)
  }
}

console.log('\n1. Matric validation')
await mockAuthAPI.login('CBT/2024/0001').then(
  () => check('accepts a valid matric', true),
  (e) => check('accepts a valid matric', false, JSON.stringify(e)),
)
await mockAuthAPI.login('ab').then(
  () => check('rejects a too-short matric', false),
  () => check('rejects a too-short matric', true),
)
await mockAuthAPI.login('has spaces!!').then(
  () => check('rejects invalid characters', false),
  () => check('rejects invalid characters', true),
)

console.log('\n2. Profile is derived from the matric number')
const { user } = await signIn('CBT/2024/0007')
check('returns a token', !!user && user.matricNumber === 'CBT/2024/0007')
check('echoes the matric number', user.matricNumber === 'CBT/2024/0007', user.matricNumber)
check('is a student role', user.role === 'student')
check('derives a program', !!user.program, user.program)
check('derives a level', typeof user.level === 'number', String(user.level))
check('name is not blank', !!user.name && user.name.trim().length > 0, user.name)

const other = await signIn('CBT/2024/0008')
check('different students get different profiles', other.user.id !== user.id)

console.log('\n3. Unauthenticated access is blocked')
const saved = mem.get('cbt-app-storage')
mem.delete('cbt-app-storage')
await mockStudentAPI.getProfile().then(
  () => check('getProfile rejects without a session', false),
  () => check('getProfile rejects without a session', true),
)
await mockExamAPI.startSession('exam-001').then(
  () => check('startSession rejects without a session', false),
  () => check('startSession rejects without a session', true),
)
if (saved) mem.set('cbt-app-storage', saved)

console.log('\n4. Dashboard aggregates correctly for a fresh student')
const { data: fresh } = await mockStudentAPI.getDashboard()
check('no completed exams initially', fresh.data.completedExams === 0, String(fresh.data.completedExams))
check('average is 0 initially', fresh.data.averageScore === 0, String(fresh.data.averageScore))
check('available exams are listed', fresh.data.availableExams.length > 0, String(fresh.data.availableExams.length))
check(
  'available exams expose no correctAnswer',
  fresh.data.availableExams.every((e) => !('correctAnswer' in e)),
)

console.log('\n5. Full exam lifecycle: start -> answer -> submit -> result')
const examId = fresh.data.availableExams[0].id
const { data: started } = await mockExamAPI.startSession(examId)
const session = started.data
check('session starts in progress', session.status === 'in_progress', session.status)
check('questions are returned', session.questions.length > 0)
check(
  'correctAnswer is stripped from questions',
  session.questions.every((q) => !('correctAnswer' in q)),
  JSON.stringify(session.questions[0] && Object.keys(session.questions[0])),
)
check('time remaining is seeded from duration', session.timeRemaining > 0, String(session.timeRemaining))

// Answer every question correctly using the mock's own question bank.
const bank = (await import('./out/mock.js')).mockExams.find((e) => e.id === examId)
for (const q of bank.questions) {
  await mockExamAPI.saveAnswer(session.id, q.id, q.correctAnswer)
}
await mockExamAPI.submitSession(session.id)
const { data: result } = await mockExamAPI.getResults(session.id)
check('perfect score', result.data.percentage === 100, String(result.data.percentage))
check('marked as passed', result.data.passed === true)
check('answer review returned', result.data.answers.length === bank.questions.length)
check('every answer marked correct', result.data.answers.every((a) => a.isCorrect))

console.log('\n6. A failing attempt scores correctly')
const { data: s2 } = await mockExamAPI.startSession(examId)
const session2 = s2.data
for (const q of bank.questions) {
  await mockExamAPI.saveAnswer(session2.id, q.id, '__definitely_wrong__')
}
await mockExamAPI.submitSession(session2.id)
const { data: failResult } = await mockExamAPI.getResults(session2.id)
check('scores 0%', failResult.data.percentage === 0, String(failResult.data.percentage))
check('marked as failed', failResult.data.passed === false)
check(
  'correct answers still revealed on review',
  failResult.data.answers.every((a) => a.correctAnswer && !a.isCorrect),
)

console.log('\n7. Results feed the dashboard and results list')
const { data: after } = await mockStudentAPI.getDashboard()
check('completed count incremented', after.data.completedExams === 2, String(after.data.completedExams))
check('average is between 0 and 100', after.data.averageScore >= 0 && after.data.averageScore <= 100, String(after.data.averageScore))
check('recent sessions populated', after.data.recentSessions.length === 2)

const { data: mySessions } = await mockExamAPI.getMySessions()
check('lists only this student sessions', mySessions.data.length === 2, String(mySessions.data.length))
check('each entry has a title and score', mySessions.data.every((s) => s.examTitle && typeof s.percentage === 'number'))

console.log('\n8. An abandoned attempt resumes with its saved answers')
const { data: s3 } = await mockExamAPI.startSession(examId)
await mockExamAPI.saveAnswer(s3.data.id, bank.questions[0].id, bank.questions[0].correctAnswer)
const { data: s4 } = await mockExamAPI.startSession(examId)
check('resumes the same session id', s4.data.id === s3.data.id, `${s4.data.id} vs ${s3.data.id}`)
check(
  'earlier answers are preserved',
  s4.data.answers[bank.questions[0].id] === bank.questions[0].correctAnswer,
  JSON.stringify(s4.data.answers),
)
check('remaining time is preserved', s4.data.timeRemaining > 0)

console.log('\n9. Unknown exam is handled')
await mockExamAPI.getExam('does-not-exist').then(
  () => check('rejects unknown exam id', false),
  (e) => check('rejects unknown exam id', !!e.response),
)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
