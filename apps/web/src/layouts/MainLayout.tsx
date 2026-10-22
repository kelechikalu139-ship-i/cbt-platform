import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/layout/Sidebar'

interface MainLayoutProps {
  branding: {
    schoolName: string
    schoolShortName: string
    primaryColor: string | null
    logoUrl: string | null
  } | null
}

export const MainLayout = ({ branding }: MainLayoutProps) => {
  return (
    <div className="flex min-h-screen">
      <Sidebar branding={branding} />
      <main className="flex-1 ml-64 p-8">
        <Outlet />
      </main>
    </div>
  )
}
