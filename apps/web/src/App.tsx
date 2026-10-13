import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { MainLayout } from './layouts/MainLayout'
import { LoginPage } from './pages/auth/LoginPage'
import { DashboardPage } from './pages/student/DashboardPage'
import { ExamsPage } from './pages/student/ExamsPage'
import { ResultsPage } from './pages/student/ResultsPage'
import { ResultPage } from './pages/student/ResultPage'
import { ProfilePage } from './pages/student/ProfilePage'
import { ExamDetailPage } from './pages/exam/ExamDetailPage'
import { ExamTakePage } from './pages/exam/ExamTakePage'
import { useAuth } from './store'

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }
  return <>{children}</>
}

const App: React.FC = () => {
  return (
    <BrowserRouter
      // Opt into the React Router v7 behaviours now: state updates wrapped
      // in startTransition, and relative links resolving from the splat
      // route's parent. Silences the v6 deprecation warnings and matches
      // the administration app.
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected routes with layout */}
          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Navigate to="/dashboard" />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/exams" element={<ExamsPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/results/:id" element={<ResultPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/exam/:id" element={<ExamDetailPage />} />
            <Route path="/exam/:id/take" element={<ExamTakePage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App