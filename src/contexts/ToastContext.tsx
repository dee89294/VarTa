/**
 * File: src/contexts/ToastContext.tsx
 * Purpose: Global animated light-studio toast notification queue (`ToastProvider` + `useToast()` hook).
 * Why required: Provides crisp non-blocking visual microinteraction feedback for mutations, auth events,
 *   meeting actions, and error states across every page.
 * Connected files:
 *   - `src/App.tsx` (wraps the entire application in `<ToastProvider>`)
 *   - Consumed by all pages (`LoginPage.tsx`, `RegisterPage.tsx`, `DashboardPage.tsx`, `EmployeesPage.tsx`,
 *     `TeamsPage.tsx`, `ScheduleMeetingPage.tsx`, `CalendarPage.tsx`, `MyMeetingsPage.tsx`,
 *     `LiveMeetingPage.tsx`, `AttendancePage.tsx`, `SettingsPage.tsx`)
 * Impact if modified/removed: Every page calling `useToast()` will throw a context error or lose status feedback.
 */
import React, { createContext, useContext, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
}

interface ToastContextValue {
  toast: (opts: { type?: ToastType; title: string; description?: string }) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    ({ type = 'info', title, description }: { type?: ToastType; title: string; description?: string }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setToasts((prev) => [...prev.slice(-4), { id, type, title, description }])
      window.setTimeout(() => {
        dismiss(id)
      }, 4200)
    },
    [dismiss]
  )

  const iconMap: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />,
    error: <XCircle className="h-5 w-5 text-rose-600 shrink-0" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />,
    info: <Info className="h-5 w-5 text-[#4D4CEF] shrink-0" />,
  }

  const borderMap: Record<ToastType, string> = {
    success: 'border-emerald-200',
    error: 'border-rose-200',
    warning: 'border-amber-200',
    info: 'border-indigo-200',
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={`pointer-events-auto varta-glass rounded-2xl p-3.5 border ${borderMap[t.type]} flex items-start gap-3`}
            >
              <div className="mt-0.5">{iconMap[t.type]}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#151722]">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-[#5E647B] mt-0.5 leading-relaxed">{t.description}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="text-[#8E94AA] hover:text-[#151722] transition-colors p-1 rounded-lg hover:bg-[#F3F4F9]"
                aria-label="Close notification"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
