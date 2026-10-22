import {
  Activity,
  BarChart3,
  ClipboardList,
  FolderTree,
  HelpCircle,
  LayoutDashboard,
  MonitorPlay,
  ScrollText,
  Settings,
  UserCog,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Permission } from '../../types'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** Gates rendering. The API must enforce the same permission. */
  permission: Permission
  /** Shown as a small trailing count when supplied. */
  badge?: number
}

/**
 * Single source of truth for admin navigation.
 *
 * Order follows how an examination department works through a cycle: set up
 * the bank, build the paper, run it, then review results and administration.
 *
 * Each item names the permission that gates it. These are the server's own
 * permission keys — the same strings the API requires — so the UI hides exactly
 * what the server would refuse.
 */
export const NAV_GROUPS: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: 'Overview',
    items: [
      {
        label: 'Dashboard',
        path: '/',
        icon: LayoutDashboard,
        permission: 'system.read',
      },
    ],
  },
  {
    heading: 'Examinations',
    items: [
      { label: 'Students', path: '/students', icon: Users, permission: 'students.read' },
      { label: 'Questions', path: '/questions', icon: HelpCircle, permission: 'questions.read' },
      { label: 'Categories', path: '/categories', icon: FolderTree, permission: 'categories.read' },
      { label: 'Exams', path: '/exams', icon: ClipboardList, permission: 'exams.read' },
      { label: 'Live monitor', path: '/live', icon: MonitorPlay, permission: 'exams.read' },
      { label: 'Results', path: '/results', icon: BarChart3, permission: 'results.read' },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Users', path: '/users', icon: UserCog, permission: 'users.read' },
      { label: 'Audit Logs', path: '/audit-logs', icon: ScrollText, permission: 'audit.read' },
      { label: 'System Health', path: '/system-health', icon: Activity, permission: 'system.read' },
      { label: 'Settings', path: '/settings', icon: Settings, permission: 'system.manage' },
    ],
  },
]

/** Flat lookup used by breadcrumbs and the page header. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter((item) =>
    item.path === '/' ? pathname === '/' : pathname.startsWith(item.path),
  ).sort((a, b) => b.path.length - a.path.length)[0]
}
