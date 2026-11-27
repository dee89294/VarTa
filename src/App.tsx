/**
 * File: src/App.tsx
 * Purpose: Root router, global providers (`MotionConfig`, `ToastProvider`, `AuthProvider`), route guards
 *   (`ProtectedRoute` and `PublicOnlyRoute`), and persistent Full-Screen / Minimized active call overlay host.
 * Why required: Coordinates authentication state from `AuthContext`, ensures unauthenticated visitors are
 *   redirected to `/login` or `/register`, and keeps active WebRTC calls running smoothly in either
 *   full-screen calling mode or a floating bottom-right minimized window across workspace navigation.
 * Connected files:
 *   - `src/main.tsx` (renders `<App />`)
 *   - `src/contexts/AuthContext.tsx` & `src/contexts/ToastContext.tsx`
 *   - `src/components/layout/AppShell.tsx` (light lavender-alabaster navigation shell for authenticated routes)
 *   - `src/pages/LiveMeetingPage.tsx` (rendered inside `WorkspaceWithCallHost` for full-screen & minimized calls)
 *   - All page components under `src/pages/*`
 * Data flow:
 *   1. `AuthProvider` resolves Supabase Auth session + active `employees` record + `user_roles` role.
 *   2. `PublicOnlyRoute` keeps signed-in users out of `/login` and `/register`.
 *   3. `ProtectedRoute` renders `<WorkspaceWithCallHost />`, which opens `/meetings/:id` in Full Screen
 *      by default and preserves the live WebRTC call in a bottom-right minimized window when minimized.
 * Impact if modified/removed: Removing `ProtectedRoute` exposes UI routes; removing `WorkspaceWithCallHost`
 *   disconnects WebRTC streams when minimizing the calling window to browse other dashboard views.
 */
import React, { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, MotionConfig } from 'framer-motion'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { DashboardPage } from './pages/DashboardPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { TeamsPage } from './pages/TeamsPage'
import { ScheduleMeetingPage } from './pages/ScheduleMeetingPage'
import { CalendarPage } from './pages/CalendarPage'
import { MyMeetingsPage } from './pages/MyMeetingsPage'
import { LiveMeetingPage } from './pages/LiveMeetingPage'
import { AttendancePage } from './pages/AttendancePage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, employee, loading, authError } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen varta-canvas flex flex-col items-center justify-center gap-3">
        <div className="h-10 w-10 rounded-full border-2 border-[#4D4CEF] border-t-transparent animate-spin" />
        <p className="text-xs font-medium text-[#6C728A]">Verifying VarTa workspace session...</p>
      </div>
    )
  }

  if (!user || !employee) {
    return <Navigate to="/login" replace state={{ error: authError }} />
  }

  return <>{children}</>
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, employee, loading } = useAuth()
  if (loading) return null
  if (user && employee) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

/**
 * Coordinates the persistent active calling window overlay above `AppShell`.
 * Navigating to `/meetings/:id` opens the call in Full Screen (`windowMode = 'fullscreen'`).
 * Clicking Minimize shrinks the window into a floating bottom-right widget and navigates
 * the background workspace to `/dashboard` without interrupting WebRTC audio/video or attendance.
 */
function WorkspaceWithCallHost() {
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.match(/^\/meetings\/([^/]+)$/)
  const routeMeetingId = match?.[1] ?? null

  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(routeMeetingId)
  const [callWindowMode, setCallWindowMode] = useState<'fullscreen' | 'minimized'>('fullscreen')

  useEffect(() => {
    if (routeMeetingId) {
      setActiveMeetingId(routeMeetingId)
      setCallWindowMode('fullscreen')
    }
  }, [routeMeetingId])

  const handleMinimizeCall = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
    setCallWindowMode('minimized')
    if (location.pathname.startsWith('/meetings/')) {
      navigate('/dashboard', { replace: true })
    }
  }

  const handleMaximizeCall = () => {
    setCallWindowMode('fullscreen')
  }

  const handleCloseCall = (dest?: string) => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
    setActiveMeetingId(null)
    setCallWindowMode('fullscreen')
    if (dest) {
      navigate(dest)
    } else if (location.pathname.startsWith('/meetings/')) {
      navigate('/my-meetings')
    }
  }

  return (
    <>
      <AppShell />
      {activeMeetingId && (
        <LiveMeetingPage
          key={activeMeetingId}
          meetingIdProp={activeMeetingId}
          windowMode={callWindowMode}
          onMinimize={handleMinimizeCall}
          onMaximize={handleMaximizeCall}
          onCloseCall={handleCloseCall}
        />
      )}
    </>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnlyRoute>
              <RegisterPage />
            </PublicOnlyRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <WorkspaceWithCallHost />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/admin-dashboard" element={<DashboardPage />} />
          <Route path="/organizer-dashboard" element={<DashboardPage />} />
          <Route path="/employee-dashboard" element={<DashboardPage />} />
          <Route path="/my-meetings" element={<MyMeetingsPage />} />
          <Route path="/live-meetings" element={<MyMeetingsPage liveOnly />} />
          <Route path="/schedule-meeting" element={<ScheduleMeetingPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/meetings/:id" element={<div />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AnimatedRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  )
}
