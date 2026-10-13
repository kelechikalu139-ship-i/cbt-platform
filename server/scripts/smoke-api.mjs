/**
 * End-to-end API smoke test against a running server.
 *
 * Exercises the real HTTP surface with real database writes: authentication,
 * RBAC denial, and create/read/update/delete on every module built in this
 * phase. Complements the vitest unit suite, which runs without a server.
 *
 * Usage: node scripts/smoke-api.mjs [--base http://127.0.0.1:5000/api/v1]
 */
const args = process.argv.slice(2)
const baseArg = args.indexOf('--base')
const BASE = baseArg >= 0 ? args[baseArg + 1] : 'http://127.0.0.1:5000/api/v1'

const ADMIN = { email: 'admin@cbt.local', password: 'Admin@12345' }

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`)
  }
}

async function call(method, path, { token, body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  return { status: response.status, body: json }
}

const unique = Date.now().toString(36)

async function main() {
  console.log(`\nCBT API smoke test -> ${BASE}\n`)

  // --- Health (unauthenticated) -----------------------------------------
  const health = await call('GET', '/health')
  check('health returns 200 without a token', health.status === 200, `got ${health.status}`)
  check('health reports database connected', health.body?.database === 'connected')

  // --- Unauthenticated access is refused ---------------------------------
  const noAuth = await call('GET', '/students')
  check('protected route refuses anonymous caller with 401', noAuth.status === 401, `got ${noAuth.status}`)

  const badToken = await call('GET', '/students', { token: 'not-a-real-token' })
  check('protected route refuses a forged token with 401', badToken.status === 401, `got ${badToken.status}`)

  // --- Authentication ----------------------------------------------------
  const badPassword = await call('POST', '/auth/login', {
    body: { email: ADMIN.email, password: 'definitely-wrong' },
  })
  const unknownUser = await call('POST', '/auth/login', {
    body: { email: `nobody-${unique}@cbt.local`, password: 'whatever123' },
  })
  check(
    'wrong password and unknown account return an identical message',
    badPassword.body?.message === unknownUser.body?.message,
    `"${badPassword.body?.message}" vs "${unknownUser.body?.message}"`,
  )
  check('failed sign-in never leaks whether the account exists', badPassword.body?.success === false)

  const login = await call('POST', '/auth/login', { body: ADMIN })
  check('valid credentials sign in', login.status === 200 && login.body?.success === true, `got ${login.status}`)
  check('response carries an access token', typeof login.body?.data?.accessToken === 'string')
  check('response carries a refresh token', typeof login.body?.data?.refreshToken === 'string')
  check('access token lifetime is 15 minutes', login.body?.data?.expiresIn === 900, `got ${login.body?.data?.expiresIn}`)
  check(
    'sign-in response never contains a password hash',
    !JSON.stringify(login.body).includes('passwordHash'),
  )

  const token = login.body?.data?.accessToken
  const refreshToken = login.body?.data?.refreshToken

  const me = await call('GET', '/auth/me', { token })
  check('/auth/me returns the current user', me.body?.data?.email === ADMIN.email)
  check('/auth/me includes granted permissions', Array.isArray(me.body?.data?.permissions))

  const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken } })
  check('refresh issues a new access token', refreshed.status === 200 && Boolean(refreshed.body?.data?.accessToken))
  check('refresh rotates the refresh token', refreshed.body?.data?.refreshToken !== refreshToken)

  const replay = await call('POST', '/auth/refresh', { body: { refreshToken } })
  check('a replayed refresh token is rejected', replay.status === 401, `got ${replay.status}`)

  // --- Validation --------------------------------------------------------
  const badLogin = await call('POST', '/auth/login', { body: { email: 'not-an-email', password: '' } })
  check('invalid login body returns 422 with field errors', badLogin.status === 422, `got ${badLogin.status}`)
  check('validation reports per-field messages', Boolean(badLogin.body?.errors?.email))

  const badUuid = await call('GET', '/students/not-a-uuid', { token })
  check('a non-UUID path parameter is rejected with 422', badUuid.status === 422, `got ${badUuid.status}`)

  // --- System ------------------------------------------------------------
  const status = await call('GET', '/system/status', { token })
  check('/system/status is reachable', status.status === 200, `got ${status.status}`)
  check('status never exposes the database URL', !JSON.stringify(status.body).includes('mysql://'))
  check('status never exposes a JWT secret', !JSON.stringify(status.body).includes(env_secret_probe()))

  // --- Students ----------------------------------------------------------
  const category = await call('GET', '/categories?limit=1', { token })
  check('categories list is reachable', category.status === 200, `got ${category.status}`)

  const subject = await call('GET', '/categories/subjects?status=ACTIVE', { token })
  check('subjects list is reachable', subject.status === 200, `got ${subject.status}`)
  const subjectId = subject.body?.data?.[0]?.id

  const studentCreate = await call('POST', '/students', {
    token,
    body: {
      studentId: `SMOKE-${unique}`,
      firstName: 'Smoke',
      lastName: 'Tester',
      program: 'Science',
      level: 100,
      semester: 1,
    },
  })
  check('create student returns 201', studentCreate.status === 201, `got ${studentCreate.status} ${JSON.stringify(studentCreate.body)}`)
  const studentId = studentCreate.body?.data?.id
  check('student response uses a UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(studentId ?? ''))

  const dupStudent = await call('POST', '/students', {
    token,
    body: { studentId: `SMOKE-${unique}`, firstName: 'Dupe', lastName: 'Tester', program: 'Science' },
  })
  check('duplicate student ID returns 409', dupStudent.status === 409, `got ${dupStudent.status}`)

  const studentGet = await call('GET', `/students/${studentId}`, { token })
  check('retrieve student returns it', studentGet.body?.data?.id === studentId)

  const studentList = await call('GET', `/students?search=SMOKE-${unique}`, { token })
  check('search finds the created student', studentList.body?.meta?.totalItems === 1, JSON.stringify(studentList.body?.meta))
  check('list returns pagination metadata', Number.isInteger(studentList.body?.meta?.totalPages))
  check('list payload is an array under data', Array.isArray(studentList.body?.data))

  const studentUpdate = await call('PATCH', `/students/${studentId}`, {
    token,
    body: { program: 'Arts' },
  })
  check('update student changes the field', studentUpdate.body?.data?.program === 'Arts', JSON.stringify(studentUpdate.body?.data))

  const paging = await call('GET', '/students?page=1&limit=1', { token })
  check('page size is honoured', paging.body?.data?.length <= 1)
  // An out-of-range page size is rejected by validation rather than silently
  // clamped, so a caller asking for 100000 rows gets an explicit 422.
  const huge = await call('GET', '/students?limit=100000', { token })
  check('an oversized page size is rejected with 422', huge.status === 422, `got ${huge.status}`)

  // --- Questions ---------------------------------------------------------
  const categoryId = category.body?.data?.[0]?.id
  let questionId = null

  if (categoryId && subjectId) {
    const q = await call('POST', '/questions', {
      token,
      body: {
        type: 'MULTIPLE_CHOICE',
        categoryId,
        subjectId,
        stem: `Smoke question ${unique}`,
        difficulty: 'EASY',
        points: 2,
        correctAnswer: 'B',
        options: [
          { label: 'A', text: 'First option' },
          { label: 'B', text: 'Second option' },
        ],
      },
    })
    check('create question returns 201', q.status === 201, `got ${q.status} ${JSON.stringify(q.body)}`)
    questionId = q.body?.data?.id
    check('staff question response includes the answer key', q.body?.data?.correctAnswer === 'B')

    const badKey = await call('POST', '/questions', {
      token,
      body: {
        type: 'MULTIPLE_CHOICE',
        categoryId,
        subjectId,
        stem: 'Bad key',
        correctAnswer: 'Z',
        options: [{ label: 'A', text: 'Only one' }, { label: 'B', text: 'Second' }],
      },
    })
    check('an answer key outside the options is rejected', badKey.status === 422, `got ${badKey.status}`)

    const oneOption = await call('POST', '/questions', {
      token,
      body: {
        type: 'MULTIPLE_CHOICE',
        categoryId,
        subjectId,
        stem: 'One option',
        correctAnswer: 'A',
        options: [{ label: 'A', text: 'Only one' }],
      },
    })
    check('a multiple-choice question needs at least two options', oneOption.status === 422, `got ${oneOption.status}`)
  }

  // --- Exams -------------------------------------------------------------
  // An exam with no questions must not be publishable: it would give every
  // candidate an empty paper. This case needs its own exam.
  const emptyExam = await call('POST', '/exams', {
    token,
    body: { title: `Smoke Empty Exam ${unique}`, durationMinutes: 10, passPercentage: 50 },
  })
  check('create exam returns 201 as a draft', emptyExam.status === 201 && emptyExam.body?.data?.status === 'DRAFT',
    `got ${emptyExam.status} ${JSON.stringify(emptyExam.body?.data?.status)}`)
  const emptyExamId = emptyExam.body?.data?.id

  const publishEmpty = await call('POST', `/exams/${emptyExamId}/publish`, { token })
  check('an exam with no questions cannot be published', publishEmpty.status === 422, `got ${publishEmpty.status}`)

  if (emptyExamId) await call('DELETE', `/exams/${emptyExamId}`, { token })

  const examCreate = await call('POST', '/exams', {
    token,
    body: {
      title: `Smoke Exam ${unique}`,
      durationMinutes: 30,
      passPercentage: 50,
      questionIds: questionId ? [questionId] : [],
    },
  })
  check('create populated exam returns 201 as a draft',
    examCreate.status === 201 && examCreate.body?.data?.status === 'DRAFT',
    `got ${examCreate.status} ${JSON.stringify(examCreate.body?.data?.status)}`)
  const examId = examCreate.body?.data?.id

  if (questionId) {
    const publish = await call('POST', `/exams/${examId}/publish`, { token })
    check('publishing a populated exam succeeds', publish.status === 200 && publish.body?.data?.status === 'PUBLISHED',
      `got ${publish.status} ${JSON.stringify(publish.body?.message)}`)

    const editPublished = await call('PATCH', `/exams/${examId}`, { token, body: { durationMinutes: 45 } })
    check('a published exam refuses structural edits', editPublished.status === 409, `got ${editPublished.status}`)

    const unpublish = await call('POST', `/exams/${examId}/unpublish`, { token })
    check('unpublishing returns the exam to draft', unpublish.status === 200 && unpublish.body?.data?.status === 'DRAFT',
      `got ${unpublish.status}`)

    // Re-attaching while it is a draft again must work.
    const attach = await call('PATCH', `/exams/${examId}`, { token, body: { questionIds: [questionId] } })
    check('questions can be attached while draft', attach.status === 200, `got ${attach.status} ${JSON.stringify(attach.body?.message)}`)
  }

  // --- Audit -------------------------------------------------------------
  // Filtered by action rather than reading the newest page: the test itself
  // writes dozens of rows, so the sign-in would fall outside a bare `limit=5`.
  const audit = await call('GET', '/audit-logs?action=LOGIN&limit=5', { token })
  check('audit log is readable', audit.status === 200, `got ${audit.status}`)
  check('audit log records the sign-in', audit.body?.meta?.totalItems > 0)
  check('audit log attributes the action to an actor', audit.body?.data?.[0]?.actorEmail === ADMIN.email)
  check('audit log never contains a password', !JSON.stringify(audit.body).toLowerCase().includes('"password"'))

  // --- Logout -----------------------------------------------------------
  // Deliberately sends no request body: a bare POST must be accepted.
  const logout = await call('POST', '/auth/logout', { token })
  check('logout with no request body succeeds', logout.status === 200, `got ${logout.status} ${JSON.stringify(logout.body)}`)

  // --- Cleanup -----------------------------------------------------------
  if (examId) await call('DELETE', `/exams/${examId}`, { token })
  if (questionId) await call('DELETE', `/questions/${questionId}`, { token })
  if (studentId) await call('DELETE', `/students/${studentId}`, { token })

  const gone = await call('GET', `/students/${studentId}`, { token })
  check('a deleted student reports 404', gone.status === 404, `got ${gone.status}`)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failures.length > 0) {
    console.log('Failed checks:')
    for (const name of failures) console.log(`  - ${name}`)
    console.log('')
  }
}

/** A string that would only appear if a secret leaked into a response. */
function env_secret_probe() {
  return 'JWT_ACCESS_SECRET'
}

main()
  .catch((error) => {
    console.error('\nSmoke test crashed:', error)
    process.exit(1)
  })
  .then(() => process.exit(failed > 0 ? 1 : 0))