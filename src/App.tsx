/**
 * File: src/App.tsx
 * Purpose: Root router for VARTA Video Meetings (`HomePage`, `LoginPage`, `RegisterPage`,
 *   `ResetPasswordPage`, `MeetingRoomPage` supporting Guest & Authenticated access, and
 *   protected organizer routes `DashboardPage`, `CreateMeetingPage`, `MyMeetingsPage`).
 */
import React from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { AppShell } from './components/layout/AppShell'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { CreateMeetingPage } from './pages/CreateMeetingPage'
import { MyMeetingsPage } from './pages/MyMeetingsPage'
import { MeetingRoomPage } from './pages/MeetingRoomPage'

function LoadingScreen() {
  return (
    <div className="min-h-screen varta-canvas flex flex-col items-center justify-center gap-3">
      <div className="h-10 w-10 rounded-full border-2 border-[#4D4CEF] border-t-transparent animate-spin" />
      <p className="text-xs font-medium text-[#6C728A]">Loading VARTA...</p>
    </div>
  )
}

/** Ensures only registered authenticated users can create/host or browse dashboard routes. */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingScreen />
  if (!user) {
    const target = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(target)}`} replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Homepage & Guest-capable Meeting Link Routes */}
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/signup" element={<RegisterPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/meeting/:id" element={<MeetingRoomPage />} />
              <Route path="/meetings/:id" element={<MeetingRoomPage />} />

              {/* Authenticated User / Organizer Routes */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/create-meeting" element={<CreateMeetingPage />} />
                <Route path="/schedule-meeting" element={<Navigate to="/create-meeting" replace />} />
                <Route path="/my-meetings" element={<MyMeetingsPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  )
}
