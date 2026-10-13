import * as mocks from '../mocks'
import type { LoginResponse } from './admin.api'
import {
  realAuditApi,
  realAuthApi,
  realCategoriesApi,
  realDashboardApi,
  realExamsApi,
  realQuestionsApi,
  realStudentsApi,
  realSubjectsApi,
  realSystemApi,
  realUsersApi,
} from './admin.api'

/**
 * The single switch between the mock layer and the live API.
 *
 * `USE_MOCK` defaults to true so the UI is fully explorable before the Node
 * backend exists. Once the server runs on the LAN, set `VITE_USE_MOCK=false`
 * in apps/admin/.env — no other file needs to change.
 *
 * Both implementations expose the same functions with the same signatures and
 * return the same unwrapped domain types, so pages and routes cannot tell which
 * one they are talking to. That is what keeps `src/mocks` disposable.
 *
 * Pages and routes import from this module only — never from `../mocks` or
 * `./admin.api` directly.
 */

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

const pick = <T>(mocked: T, real: T): T => (USE_MOCK ? mocked : real)

/**
 * `notYet` marks a capability with no server endpoint yet.
 *
 * It throws on call rather than resolving a stub, so a screen that offers the
 * action fails loudly instead of appearing to succeed while changing nothing —
 * which is the failure mode that matters when an exam officer believes they
 * published a paper.
 */
const notYet = (what: string): never => {
  throw new Error(
    `${what} has no backend endpoint yet and is scheduled for a later phase.`,
  )
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Auth is switched between the fixture layer and the live API by `USE_MOCK`.
 *
 * The mock login returns the same `{ user, accessToken, ... }` bundle as the real
 * endpoint so the sign-in screen behaves identically in either mode.
 */
export const authApi = pick(
  {
    me: () => mocks.mockUsersApi.me(),
    login: async (identifier: string, password: string): Promise<LoginResponse> => {
      if (!identifier.trim() || !password) {
        throw new Error('Enter an email address and password.')
      }
      return {
        user: await mocks.mockUsersApi.me(),
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 900,
        tokenType: 'Bearer',
      }
    },
    logout: async (): Promise<void> => undefined,
    changePassword: async (): Promise<void> => undefined,
  },
  realAuthApi,
)

export const dashboardApi = pick({ summary: () => mocks.mockDashboardApi.summary() }, realDashboardApi)

/**
 * Only `health` and `status` exist server-side. Settings, access URLs and service
 * restart belong to the settings and licensing phases, so they are exposed here
 * solely in mock mode rather than being wired to endpoints that would 404.
 */
export const systemApi = pick(
  {
    health: () => mocks.mockSystemApi.health(),
    status: () => mocks.mockSystemApi.status(),
    settings: () => mocks.mockSystemApi.settings(),
    saveSettings: mocks.mockSystemApi.saveSettings,
    accessUrls: () => mocks.mockSystemApi.accessUrls(),
    restartService: async (): Promise<void> => undefined,
  },
  {
    health: realSystemApi.health,
    status: realSystemApi.status,
    settings: (): Promise<never> => notYet('Reading system settings'),
    saveSettings: (): Promise<never> => notYet('Saving system settings'),
    accessUrls: (): Promise<never> => notYet('Access URLs'),
    restartService: (): Promise<never> => notYet('Restarting the service'),
  },
)

export const studentsApi = pick(
  {
    list: mocks.mockStudentsApi.list,
    get: mocks.mockStudentsApi.get,
    classes: mocks.mockStudentsApi.classes,
    options: mocks.mockStudentsApi.options,
    endSession: mocks.mockStudentsApi.endSession,
    create: (): Promise<never> => notYet('Creating a student'),
    update: (): Promise<never> => notYet('Editing a student'),
    setStatus: (): Promise<never> => notYet('Changing student status'),
    remove: (): Promise<never> => notYet('Deleting a student'),
  },
  realStudentsApi,
)

/**
 * Mutations the backend already implements. Exposed as a separate object
 * so a page can call the real endpoint regardless of `VITE_USE_MOCK`,
 * which is the point of "start adding live students": the mock layer has
 * no persistence, so a mutation there would silently do nothing.
 */
export const studentMutations = {
  create: realStudentsApi.create,
  update: realStudentsApi.update,
  setStatus: realStudentsApi.setStatus,
  remove: realStudentsApi.remove,
  endSession: realStudentsApi.endSession,
}

export const questionsApi = pick(
  {
    list: mocks.mockQuestionsApi.list,
    get: mocks.mockQuestionsApi.get,
    subjects: mocks.mockQuestionsApi.subjects,
    create: (): Promise<never> => notYet('Creating a question'),
    update: (): Promise<never> => notYet('Editing a question'),
    remove: (): Promise<never> => notYet('Deleting a question'),
    bulkImport: mocks.mockQuestionsApi.bulkImport,
  },
  realQuestionsApi,
)

/**
 * Mutations the backend already implements. Exposed as a separate object
 * so a page can call the real endpoint regardless of `VITE_USE_MOCK`,
 * which is the point of "start adding live questions": the mock layer has
 * no persistence, so a mutation there would silently do nothing.
 */
export const questionMutations = {
  create: realQuestionsApi.create,
  update: realQuestionsApi.update,
  remove: realQuestionsApi.remove,
  bulkImport: realQuestionsApi.bulkImport,
}

export const categoriesApi = pick(
  {
    list: mocks.mockCategoriesApi.list,
    subjects: mocks.mockCategoriesApi.subjects,
    create: mocks.mockCategoriesApi.create,
    update: mocks.mockCategoriesApi.update,
    setActive: mocks.mockCategoriesApi.setActive,
    remove: mocks.mockCategoriesApi.remove,
  },
  realCategoriesApi,
)

/**
 * Mutations the backend already implements. Exposed as a separate object
 * so a page can call the real endpoint regardless of `VITE_USE_MOCK`,
 * which is the point of "start adding live categories": the mock layer has
 * no persistence, so a mutation there would silently do nothing.
 */
export const categoryMutations = {
  create: realCategoriesApi.create,
  update: realCategoriesApi.update,
  setActive: realCategoriesApi.setActive,
  remove: realCategoriesApi.remove,
}

/** Subjects have no list endpoint of their own; they are read via categories. */
export const subjectsApi = pick(
  {
    create: mocks.mockSubjectsApi.create,
    update: mocks.mockSubjectsApi.update,
    remove: mocks.mockSubjectsApi.remove,
  },
  realSubjectsApi,
)

/** Subject mutations, same pattern as `categoryMutations`. */
export const subjectMutations = {
  create: realSubjectsApi.create,
  update: realSubjectsApi.update,
  remove: realSubjectsApi.remove,
}

/**
 * Exam mutations the backend already implements. Same pattern as
 * `questionMutations`: always the real endpoint, because the mock
 * layer has no persistence and a silently-dropped exam is worse
 * than a failed request.
 */
export const examMutations = {
  create: realExamsApi.create,
  update: realExamsApi.update,
  remove: realExamsApi.remove,
  publish: realExamsApi.publish,
  unpublish: realExamsApi.unpublish,
}

export const examsApi = pick(
  {
    list: mocks.mockExamsApi.list,
    get: mocks.mockExamsApi.get,
    create: (): Promise<never> => notYet('Creating an examination'),
    update: (): Promise<never> => notYet('Editing an examination'),
    publish: (): Promise<never> => notYet('Publishing an examination'),
    unpublish: (): Promise<never> => notYet('Unpublishing an examination'),
    remove: (): Promise<never> => notYet('Deleting an examination'),
  },
  realExamsApi,
)

/**
 * Results and grading have no backend in this phase, so this group is mock-only.
 *
 * There is no results router in the server and no `realResultsApi` to pair with.
 * The screen still exists to show the intended shape, but it is honest that the
 * data is illustrative rather than real.
 */
export const resultsApi = {
  list: mocks.mockResultsApi.list,
  get: mocks.mockResultsApi.get,
  summary: () => mocks.mockResultsApi.summary(),
  studentPerformance: mocks.mockResultsApi.studentPerformance,
}

export const usersApi = pick(
  {
    list: mocks.mockUsersApi.list,
    create: (): Promise<never> => notYet('Creating a user'),
    update: (): Promise<never> => notYet('Editing a user'),
    setStatus: (): Promise<never> => notYet('Changing user status'),
    remove: (): Promise<never> => notYet('Deleting a user'),
  },
  realUsersApi,
)

export const auditApi = pick(
  {
    list: mocks.mockAuditApi.list,
    actions: (): Promise<never> => notYet('Audit action filters'),
  },
  realAuditApi,
)

export { ApiError, API_BASE_URL, http, TOKEN_STORAGE_KEY } from './http'
export type { LoginResponse } from './admin.api'
