/**
 * File: src/components/layout/AppShell.tsx
 * Purpose: Minimal authenticated navigation header & layout wrapper focused exclusively on VARTA meetings
 *   (Dashboard, Create New Meeting, My Meetings, User Profile Pill, and Logout).
 * Connected files:
 *   - `src/App.tsx` (renders `<AppShell />` for protected workspace routes)
 *   - `src/contexts/AuthContext.tsx` (`profile`, `signOut()`)
 */
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CalendarPlus, LayoutDashboard, LogOut, Video } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { cn } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'

export function AppShell() {
  const { profile, user, signOut } = useAuth()
  const navigate = useNavigate()

  const displayName = profile?.full_name || String(user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Host')

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  const navItems = [
    { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
    { label: 'Create Meeting', to: '/create-meeting', icon: CalendarPlus },
    { label: 'My Meetings', to: '/my-meetings', icon: Video },
  ]

  return (
    <div className="min-h-screen varta-canvas flex flex-col">
      <header className="sticky top-0 z-30 bg-[#F7F8FC]/90 backdrop-blur-xl border-b border-[#E6E8F2]">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="inline-flex items-center gap-2.5 shrink-0">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center shadow-[0_8px_18px_-6px_rgba(77,76,239,0.5)] text-white font-display font-extrabold text-base">
                V
              </div>
              <span className="font-display text-lg font-bold text-[#151722] tracking-tight">VarTa</span>
            </Link>

            <nav className="hidden md:flex items-center gap-1.5">
              {navItems.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-all',
                        isActive
                          ? 'bg-[#15161C] text-white shadow-xs'
                          : 'text-[#5E647B] hover:text-[#151722] hover:bg-white'
                      )
                    }
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </NavLink>
                )
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#E5E8F2]">
              <Avatar name={displayName} size="sm" shape="circle" />
              <span className="text-xs font-semibold text-[#151722] max-w-[140px] truncate">{displayName}</span>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-rose-50 border border-[#E5E8F2] hover:border-rose-200 text-xs font-semibold text-[#454A62] hover:text-rose-700 transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>

        {/* Mobile Nav Bar */}
        <div className="md:hidden border-t border-[#ECEDF5] px-4 py-2 flex items-center gap-2 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
                    isActive ? 'bg-[#15161C] text-white' : 'bg-white text-[#5E647B] border border-[#E6E8F2]'
                  )
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            )
          })}
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
