import { Link } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'
import { EmptyState, Panel } from '../components/ui'

export function NotFoundPage() {
  return (
    <Panel>
      <EmptyState
        variant="page"
        icon={<Compass className="h-5 w-5" />}
        title="Page not found"
        description="The address you followed does not match any section of the administration interface."
        action={
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 text-sm font-medium shadow-sm transition-colors hover:bg-[var(--cb-primary-dark)]"
          >
            <Home className="h-4 w-4" />
            Return to dashboard
          </Link>
        }
      />
    </Panel>
  )
}
