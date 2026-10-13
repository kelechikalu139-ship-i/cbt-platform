import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/layout/Sidebar'

export const MainLayout = () => {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <Outlet />
      </main>
    </div>
  )
}