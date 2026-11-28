/**
 * File: src/components/ui/StatusBadge.tsx
 * Purpose: Semantic pill badges for Meeting Status (`scheduled`, `active`, `ended`, `cancelled`)
 *   and Participant Role (`organizer`, `registered`, `guest`).
 */
import { cn } from '../../lib/utils'
import type { MeetingStatus, ParticipantType } from '../../types/database'

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const styles: Record<MeetingStatus, string> = {
    active: 'bg-rose-50 text-rose-700 border-rose-200',
    scheduled: 'bg-[#4D4CEF]/10 text-[#3E3EE0] border-[#4D4CEF]/25',
    ended: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-[#EFF1F6] text-[#787F96] border-[#DFE3EE]',
  }
  const labels: Record<MeetingStatus, string> = {
    active: 'Live Now',
    scheduled: 'Scheduled',
    ended: 'Ended',
    cancelled: 'Cancelled',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border', styles[status])}>
      {status === 'active' && <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />}
      {labels[status]}
    </span>
  )
}

export function ParticipantTypeBadge({ type }: { type: ParticipantType }) {
  const styles: Record<ParticipantType, string> = {
    organizer: 'bg-[#15161C] text-white border-[#15161C]',
    registered: 'bg-[#4D4CEF]/10 text-[#3E3EE0] border-[#4D4CEF]/25',
    guest: 'bg-[#9C65E5]/12 text-[#773DC8] border-[#9C65E5]/25',
  }
  const labels: Record<ParticipantType, string> = {
    organizer: 'Host',
    registered: 'Member',
    guest: 'Guest',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border', styles[type])}>
      {labels[type]}
    </span>
  )
}
