/**
 * File: src/components/ui/Avatar.tsx
 * Purpose: Reusable employee avatar component supporting Supabase Storage profile photos (`src`),
 *   deterministic gradient initials fallback, hover zoom animation, crisp white borders, and status dots.
 * Why required: Keeps employee portraits consistent across Sidebar, Dashboard avatar clusters, Teams cards,
 *   Employees table, and Live Video Meeting tiles matching the clean light-studio theme.
 * Connected files:
 *   - `src/lib/utils.ts` (`cn`, `getAvatarGradient`, `getInitials`)
 *   - `src/pages/TeamsPage.tsx`, `EmployeesPage.tsx`, `DashboardPage.tsx`, `LiveMeetingPage.tsx`, `AttendancePage.tsx`, `SettingsPage.tsx`
 * Impact if modified/removed: Breaks portrait rendering and status dot indicators across the entire UI.
 */
import { cn, getAvatarGradient, getInitials } from '../../lib/utils'

interface AvatarProps {
  name?: string | null
  src?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  shape?: 'rounded' | 'circle'
  className?: string
  zoomOnHover?: boolean
  statusDot?: 'present' | 'waiting' | 'absent' | 'online' | null
}

const sizeClasses: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-7 w-7 text-[11px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-20 w-20 text-xl',
  '2xl': 'h-full w-full text-3xl',
}

const dotColor: Record<NonNullable<AvatarProps['statusDot']>, string> = {
  present: 'bg-emerald-500',
  online: 'bg-emerald-500',
  waiting: 'bg-amber-400',
  absent: 'bg-rose-500',
}

export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'rounded',
  className,
  zoomOnHover = false,
  statusDot = null,
}: AvatarProps) {
  const gradient = getAvatarGradient(name)
  const initials = getInitials(name)
  const radius = shape === 'circle' ? 'rounded-full' : size === 'xs' || size === 'sm' ? 'rounded-xl' : 'rounded-2xl'

  return (
    <div className={cn('relative inline-flex shrink-0 select-none', sizeClasses[size], className)}>
      <div
        className={cn(
          'h-full w-full overflow-hidden border border-white shadow-sm bg-gradient-to-br flex items-center justify-center font-display font-bold text-white',
          radius,
          gradient
        )}
      >
        {src ? (
          <img
            src={src}
            alt={name || 'Employee'}
            className={cn(
              'h-full w-full object-cover',
              zoomOnHover && 'transition-transform duration-500 ease-out group-hover:scale-105'
            )}
          />
        ) : (
          <span className={cn(zoomOnHover && 'transition-transform duration-500 ease-out group-hover:scale-110')}>
            {initials}
          </span>
        )}
      </div>
      {statusDot && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white',
            dotColor[statusDot]
          )}
        />
      )}
    </div>
  )
}
