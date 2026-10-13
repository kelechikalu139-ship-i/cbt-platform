import axios from 'axios'
import { mockAuthAPI, mockExamAPI, mockStudentAPI } from './mock'
import type { Student, User } from '../types'

/**
 * Default to the relative API path: the Vite dev server
 * proxies `/api` to the Node.js API, and in production the
 * student app is served from the same host as the API.
 * Override with VITE_API_URL for a separate origin.
 */
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

/**
 * While the backend is not running, the app falls back to the in-memory mock
 * layer so every screen is usable. Set VITE_USE_MOCK=false once the API is live.
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

export const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('cbt-app-storage')
    if (token) {
      try {
        const parsed = JSON.parse(token)
        if (parsed.state?.token) {
          config.headers.Authorization = `Bearer ${parsed.state.token}`
        }
      } catch {
        // ignore parse error
      }
    }
    return config
  },
  (error) => Promise.reject(error),
)

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('cbt-app-storage')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

/** The `users` row as the API's sign-in response carries it. */
interface PublicUserShape {
  id: string
  fullName: string
  role: string
  student: { studentId: string; program: string; level: number } | null
}

/** Map the API's public user onto the shape this app keeps in its store. */
function toAppUser(user: PublicUserShape): User {
  return {
    id: user.id,
    matricNumber: user.student?.studentId ?? '',
    name: user.fullName,
    program: user.student?.program ?? '',
    level: user.student?.level ?? 0,
    role: user.role === 'STUDENT' ? 'student' : 'admin',
  }
}

const realAuthAPI = {
  /**
   * Students sign in with their admission number only (no password).
   * The server enforces single-session semantics.
   */
  studentLogin: async (matricNumber: string) => {
    const response = await api.post('/auth/student-login', { studentId: matricNumber })
    const data = response.data.data
    return {
      data: {
        success: true,
        data: { user: toAppUser(data.user), token: data.accessToken },
      },
    }
  },
  me: async () => {
    const response = await api.get('/auth/me')
    return {
      data: {
        success: true,
        data: { user: toAppUser(response.data.data) },
      },
    }
  },
  logout: () => api.post('/auth/logout'),
}

const realExamAPI = {
  getExams: (params?: Record<string, unknown>) => api.get('/portal/exams', { params }),
  getExam: (id: string) => api.get(`/portal/exams/${id}`),
  startSession: (examId: string) => api.post('/portal/sessions/start', { examId }),
  getSession: (id: string) => api.get(`/portal/sessions/${id}`),
  saveAnswer: (sessionId: string, questionId: string, answer: string) =>
    api.post(`/portal/sessions/${sessionId}/answer`, { questionId, answer }),
  submitSession: (sessionId: string) => api.post(`/portal/sessions/${sessionId}/submit`),
  getResults: (sessionId: string) => api.get(`/portal/sessions/${sessionId}/result`),
  getMySessions: () => api.get('/portal/sessions/mine'),
}

const realStudentAPI = {
  getProfile: () => api.get('/portal/me'),
  updateProfile: (data: Partial<Student>) => api.put('/portal/me', data),
  getDashboard: () => api.get('/portal/dashboard'),
}

export const authAPI = USE_MOCK ? mockAuthAPI : realAuthAPI
export const examAPI = USE_MOCK ? mockExamAPI : realExamAPI
export const studentAPI = USE_MOCK ? mockStudentAPI : realStudentAPI

export default api
