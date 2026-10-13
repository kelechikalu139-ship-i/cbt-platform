import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './components/ui'
import { AuthProvider } from './providers/AuthProvider'
import { QueryProvider } from './providers/QueryProvider'
import { AppRoutes } from './routes'

/**
 * Root of the CBT administration application.
 *
 * Provider order matters:
 *   QueryProvider  — data fetching and caching
 *   BrowserRouter  — routing context
 *   AuthProvider   — session hydration (needs the router for redirects)
 *   ErrorBoundary  — last line of defence around the whole shell
 */
export default function App() {
  return (
    <ErrorBoundary label="The administration interface">
      <QueryProvider>
        <BrowserRouter
          basename={import.meta.env.BASE_URL}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </QueryProvider>
    </ErrorBoundary>
  )
}
