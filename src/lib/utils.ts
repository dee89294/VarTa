/**
 * File: src/lib/utils.ts
 * Purpose: Pure utility helpers for Tailwind class merging, date/time/duration formatting, avatar initials,
 *   deterministic bright studio avatar gradients, and meeting code generation.
 * Why required: Keeps formatting consistent across dashboards, calendars, attendance tables, and live meetings.
 * Connected files:
 *   - `src/components/ui/Avatar.tsx` (`cn`, `getInitials`, `getAvatarGradient`)
 *   - `src/components/ui/StatusBadge.tsx` (`cn`)
 *   - `src/pages/ScheduleMeetingPage.tsx` (`generateMeetingCode`, `formatDateTime`)
 *   - `src/pages/LiveMeetingPage.tsx` (`cn`, `formatClockTimer`, `formatDate`, `formatTime`)
 *   - `src/pages/AttendancePage.tsx`, `ReportsPage.tsx`, `CalendarPage.tsx`, `DashboardPage.tsx`, `MyMeetingsPage.tsx`, `EmployeesPage.tsx`
 * Impact if modified/removed: UI components and pages will fail to compile or display unformatted timestamps.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merges conditional Tailwind class lists while resolving conflicting utility classes safely. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Formats an ISO timestamp into short localized date + time (e.g., "Nov 26, 09:30 AM"). */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Formats an ISO timestamp into localized time only; used in attendance columns, cards, and chat bubbles. */
export function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Formats an ISO timestamp into localized calendar date (e.g., "Nov 26, 2026"). */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Converts integer seconds into human-readable duration (e.g., "1h 12m" or "42m 15s"). */
export function formatDurationSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0))
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const rem = s % 60
  if (hrs > 0) return `${hrs}h ${mins}m`
  if (mins > 0) return `${mins}m ${rem}s`
  return `${rem}s`
}

/** Formats elapsed seconds as a digital meeting clock (`MM:SS` or `HH:MM:SS`) for `LiveMeetingPage.tsx`. */
export function formatClockTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const rem = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(rem)}` : `${pad(mins)}:${pad(rem)}`
}

/** Derives 1-2 uppercase initials from an employee's full name for fallback avatar rendering. */
export function getInitials(name?: string | null): string {
  if (!name) return 'VT'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministically maps an employee name to a vibrant light-studio gradient for fallback avatars. */
export function getAvatarGradient(seed?: string | null): string {
  const palettes = [
    'from-[#4D4CEF] via-[#6062F4] to-[#8C64E8]',
    'from-[#9C65E5] via-[#8956DE] to-[#5658EC]',
    'from-emerald-500 via-teal-500 to-cyan-500',
    'from-amber-500 via-orange-500 to-rose-500',
    'from-sky-500 via-indigo-500 to-[#4D4CEF]',
    'from-fuchsia-500 via-purple-500 to-indigo-600',
  ]
  const str = seed || 'VarTa'
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  }
  return palettes[hash % palettes.length]
}

/** Generates a human-readable unique meeting code (`VRT-XXXX`) used when scheduling new meetings. */
export function generateMeetingCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000)
  return `VRT-${num}`
}

/** Generates a strong randomized password mixing uppercase, lowercase, digits, and symbols. */
export function generateStrongPassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%&*'
  const all = upper + lower + digits + symbols

  const pick = (pool: string): string => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(1)
      crypto.getRandomValues(buf)
      return pool[buf[0] % pool.length]
    }
    return pool[Math.floor(Math.random() * pool.length)]
  }

  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  const restLength = Math.max(0, length - required.length)
  const chars = [...required]
  for (let i = 0; i < restLength; i++) {
    chars.push(pick(all))
  }
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const buf = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 1000)
    const j = buf % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
