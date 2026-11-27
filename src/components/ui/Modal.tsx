/**
 * File: src/components/ui/Modal.tsx
 * Purpose: Accessible, Framer Motion-animated light studio modal dialog with Escape-key dismissal.
 * Why required: Hosts create/edit employee forms, announcement composer, calendar event inspector,
 *   and live meeting device/invite dialogs cleanly in the soft alabaster-white aesthetic.
 * Connected files:
 *   - `src/pages/DashboardPage.tsx`, `EmployeesPage.tsx`, `CalendarPage.tsx`, `LiveMeetingPage.tsx`
 * Impact if modified/removed: All modal workflows (employee editing, calendar rescheduling, device settings) break.
 */
import React, { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  maxWidth?: string
  children: React.ReactNode
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = 'max-w-xl',
  children,
}: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#171A2E]/35 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={`relative z-10 w-full ${maxWidth} bg-white rounded-3xl shadow-[0_28px_70px_-15px_rgba(23,26,56,0.22)] border border-[#E6E8F2] overflow-hidden my-8`}
          >
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#EEF0F7] bg-[#F9FAFD]">
              <div>
                <h2 className="font-display text-lg font-bold text-[#151722]">{title}</h2>
                {subtitle && <p className="text-xs text-[#6E748C] mt-0.5">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full bg-white hover:bg-[#EFF1F7] border border-[#E6E8F2] text-[#6E748C] hover:text-[#151722] transition-colors"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
