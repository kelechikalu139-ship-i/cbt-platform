import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { systemApi } from '../services'
import { applyBrandColor } from '../utils/theme'
import { cn } from '../utils'
import type { SystemSettings } from '../types'

const COLLAPSE_KEY = 'cbt-admin-nav-collapsed'

/**
 * Application shell for the administration interface.
 *
 * Three regions: persistent sidebar (collapsible), sticky header, and the
 * scrollable content area. Sidebar collapse and mobile-drawer state are stored
 * locally because they are per-workstation preferences, not server state.
 *
 * Institution branding (logo + primary colour) is loaded from system settings
 * and applied to the shell so every screen reflects the school's identity.
 */
export function AdminLayout() {
  const [collapsed, setCollapsed] = useLocalStorage(COLLAPSE_KEY, false)
  const [navOpen, setNavOpen] = useState(false)
  const { pathname } = useLocation()

  const { data: settings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => systemApi.settings(),
    staleTime: 5 * 60_000,
  })

  // Apply the institution's primary colour to the shell so it takes effect
  // everywhere (buttons, badges, focus rings, sidebar mark). Pass `null` to
  // restore the compile-time default.
  useEffect(() => {
    applyBrandColor(settings?.primaryColor ?? null)
  }, [settings?.primaryColor])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  // Escape closes the drawer, matching the modal convention elsewhere.
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])

  const logoUrl = settings?.logoUrl ?? null
  const primaryColor = settings?.primaryColor ?? null

  return (
    <div className="min-h-screen bg-slate-100">
        <Sidebar
          open={navOpen}
          onClose={() => setNavOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          logoUrl={logoUrl}
        />

      <div className={cn('flex min-h-screen flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-16' : 'lg:pl-60')}>
        <Header
          onOpenNav={() => setNavOpen(true)}
          logoUrl={logoUrl}
          primaryColor={primaryColor}
        />

        <main id="main-content" className="flex-1 px-4 py-5 sm:px-5 lg:px-6">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>

        <footer className="border-t border-slate-200 px-5 py-3">
          <p className="mx-auto max-w-[1600px] text-2xs text-slate-400">
            CBT Examination System — administration interface. Runs entirely on the local
            network.
          </p>
        </footer>
      </div>
    </div>
  )
}
