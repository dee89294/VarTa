/**
 * File: src/components/meeting/MeetingStageTiles.tsx
 * Purpose: Reusable dark-theme LiveKit video, screen-share, and thumbnail tile components
 *   used across Gallery, Focus, and Screen Share layouts inside `LiveKitRoomView.tsx`.
 * Features:
 *   - Real-time active speaker detection via LiveKit's `useIsSpeaking()` hook.
 *   - Camera-off Avatar fallback, muted/unmuted mic status pill, and Host/Guest role badge.
 *   - Screen-sharing indicator badge on presenter camera tiles and aspect-preserving
 *     (`object-contain`) centered rendering on shared screen tiles.
 *   - Instant click-to-focus selection without unsubscribing or reconnecting LiveKit tracks.
 * Connected files:
 *   - `src/components/meeting/LiveKitRoomView.tsx` (orchestrates layout modes and clicks)
 *   - `src/components/ui/Avatar.tsx` (renders fallback profile initials when camera is off)
 */
import {
  VideoTrack,
  isTrackReference,
  useIsSpeaking,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react'
import type { Participant } from 'livekit-client'
import { Maximize2, Mic, MicOff, MonitorUp, Volume2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'
import type { ParticipantType } from '../../types/database'

/**
 * Extracts `participantType` ('organizer' | 'registered' | 'guest') from LiveKit
 * participant JSON metadata populated by the `get-livekit-token` Edge Function.
 */
export function parseParticipantRole(participant: Participant): ParticipantType {
  if (!participant.metadata) return 'guest'
  try {
    const parsed = JSON.parse(participant.metadata) as { participantType?: ParticipantType }
    return parsed.participantType ?? 'guest'
  } catch {
    return 'guest'
  }
}

/** Displays compact Host or Guest badge beside a participant's name. */
export function RoleTag({ type }: { type: ParticipantType }) {
  if (type === 'organizer') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-[#4D4CEF] text-white text-[10px] font-bold shrink-0">
        Host
      </span>
    )
  }
  if (type === 'guest') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-[#9C65E5]/25 text-purple-100 text-[10px] font-semibold shrink-0">
        Guest
      </span>
    )
  }
  return null
}

export interface MeetingParticipantTileProps {
  /** LiveKit camera track reference or placeholder for a connected participant. */
  trackRef: TrackReferenceOrPlaceholder
  /** Display density variant depending on main stage, gallery cell, or compact sidebar thumbnail. */
  variant: 'gallery' | 'main' | 'sidebar'
  /** Highlights this tile as the currently selected focus target. */
  isSelected?: boolean
  /** Shows a subtle badge on the participant's camera tile when they are actively sharing their screen. */
  isSharingScreen?: boolean
  /** Triggered when a user clicks this tile to expand or focus it into the main viewing area. */
  onSelect?: () => void
  /** Optional quick button when clicking the screen-share badge inside Gallery View to open Screen Share View. */
  onJumpToScreenShare?: () => void
}

/**
 * Renders a participant video tile (or camera-off avatar card) backed directly by
 * LiveKit participant state and real-time `useIsSpeaking()` updates.
 */
export function MeetingParticipantTile({
  trackRef,
  variant,
  isSelected = false,
  isSharingScreen = false,
  onSelect,
  onJumpToScreenShare,
}: MeetingParticipantTileProps) {
  const participant = trackRef.participant
  const isSpeaking = useIsSpeaking(participant)
  const displayName = participant.name || participant.identity
  const isLocal = participant.isLocal
  const roleType = parseParticipantRole(participant)
  const isMicOn = participant.isMicrophoneEnabled
  const hasLiveVideo =
    isTrackReference(trackRef) && Boolean(trackRef.publication) && !trackRef.publication.isMuted

  const isSidebar = variant === 'sidebar'
  const isMain = variant === 'main'

  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect()
              }
            }
          : undefined
      }
      title={onSelect ? `Click to focus ${displayName}` : undefined}
      className={cn(
        'group relative rounded-2xl overflow-hidden bg-[#171B2A] border transition-all duration-200 flex items-center justify-center select-none',
        isMain && 'w-full h-full min-h-[260px] sm:min-h-[340px] rounded-3xl',
        variant === 'gallery' && 'w-full h-full min-h-[165px] sm:min-h-[200px] sm:rounded-3xl',
        isSidebar && 'w-44 sm:w-52 lg:w-full aspect-video shrink-0',
        onSelect && 'cursor-pointer hover:border-indigo-400/60 hover:bg-[#1C2134]',
        isSelected
          ? 'border-[#6163F6] ring-2 ring-[#6163F6]/65 shadow-[0_0_24px_-6px_rgba(97,99,246,0.55)]'
          : isSpeaking
            ? 'border-emerald-400/80 ring-2 ring-emerald-400/50 shadow-[0_0_22px_-6px_rgba(52,211,153,0.5)]'
            : 'border-white/10'
      )}
    >
      {hasLiveVideo && isTrackReference(trackRef) ? (
        <VideoTrack
          trackRef={trackRef}
          className={cn(
            'w-full h-full',
            isMain ? 'object-contain bg-black' : 'object-cover',
            isLocal && 'scale-x-[-1]'
          )}
        />
      ) : (
        <div
          className={cn(
            'w-full h-full bg-gradient-to-br from-[#1C2032] via-[#151827] to-[#11131E] flex flex-col items-center justify-center',
            isSidebar ? 'gap-1.5 p-2' : 'gap-2.5 p-4'
          )}
        >
          <Avatar
            name={displayName}
            size={isMain ? 'xl' : isSidebar ? 'sm' : 'lg'}
            shape="circle"
            className={cn('ring-4', isSpeaking ? 'ring-emerald-400/60' : 'ring-white/10')}
          />
          {!isSidebar && <span className="text-[11px] font-medium text-white/55">Camera off</span>}
        </div>
      )}

      {/* Top Badges: Active Speaker / Screen Share Indicator / Focus Hint */}
      <div
        className={cn(
          'absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none',
          isSidebar && 'top-1.5 left-1.5 right-1.5'
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isMain && isSelected && (
            <span className="px-2 py-0.5 rounded-full bg-[#4D4CEF]/90 text-white text-[10px] font-bold border border-indigo-300/35">
              Focused
            </span>
          )}

          {isSpeaking && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/90 text-black text-[10px] font-bold shadow-sm">
              <Volume2 className="h-3 w-3 animate-pulse" />
              {!isSidebar && 'Speaking'}
            </span>
          )}

          {isSharingScreen && (
            <button
              type="button"
              onClick={(e) => {
                if (!onJumpToScreenShare) return
                e.stopPropagation()
                onJumpToScreenShare()
              }}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#4D4CEF]/90 text-white text-[10px] font-semibold border border-indigo-300/30',
                onJumpToScreenShare && 'pointer-events-auto hover:bg-[#3F41E2] cursor-pointer'
              )}
              title={onJumpToScreenShare ? 'Switch to Screen Share View' : 'Sharing screen'}
            >
              <MonitorUp className="h-3 w-3 shrink-0" />
              {!isSidebar && <span>Sharing screen</span>}
            </button>
          )}
        </div>

        {onSelect && !isMain && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-black/70 border border-white/15 text-[10px] font-semibold text-white/90 inline-flex items-center gap-1 shrink-0">
            <Maximize2 className="h-2.5 w-2.5" />
            {!isSidebar && 'Focus'}
          </span>
        )}
      </div>

      {/* Bottom Name, Role Tag, and Mic Status */}
      <div
        className={cn(
          'absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none',
          isSidebar && 'bottom-1.5 left-1.5 right-1.5'
        )}
      >
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full bg-black/65 backdrop-blur-md border border-white/15 min-w-0 max-w-[82%]',
            isSidebar ? 'px-2 py-0.5' : 'px-3 py-1'
          )}
        >
          <span className={cn('font-semibold text-white truncate', isSidebar ? 'text-[10px]' : 'text-xs')}>
            {displayName}
            {isLocal ? ' (You)' : ''}
          </span>
          {!isSidebar && <RoleTag type={roleType} />}
        </div>

        <span
          className={cn(
            'rounded-full flex items-center justify-center shrink-0 border border-white/10',
            isSidebar ? 'h-5 w-5' : 'h-7 w-7',
            isMicOn
              ? isSpeaking
                ? 'bg-emerald-500 text-black'
                : 'bg-[#4D4CEF]/90 text-white'
              : 'bg-rose-600 text-white'
          )}
          title={isMicOn ? 'Microphone on' : 'Microphone muted'}
        >
          {isMicOn ? (
            <Mic className={isSidebar ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
          ) : (
            <MicOff className={isSidebar ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
          )}
        </span>
      </div>
    </div>
  )
}

export interface MeetingScreenShareTileProps {
  /** LiveKit `Track.Source.ScreenShare` track reference. */
  trackRef: TrackReference
  /** Whether rendered in the large main stage or as a compact clickable sidebar thumbnail. */
  variant: 'main' | 'sidebar'
  /** Highlights tile if selected. */
  isSelected?: boolean
  /** Triggered when clicking a sidebar screen-share thumbnail to bring it back to main view. */
  onSelect?: () => void
}

/**
 * Renders an active LiveKit screen share centered without aspect distortion (`object-contain`),
 * both for full-stage presentation and as a clickable sidebar thumbnail when another participant is focused.
 */
export function MeetingScreenShareTile({
  trackRef,
  variant,
  isSelected = false,
  onSelect,
}: MeetingScreenShareTileProps) {
  const presenter = trackRef.participant
  const presenterName = presenter.name || presenter.identity
  const isLocalPresenter = presenter.isLocal
  const isSidebar = variant === 'sidebar'

  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect()
              }
            }
          : undefined
      }
      title={onSelect ? `Click to focus ${presenterName}'s shared screen` : undefined}
      className={cn(
        'group relative overflow-hidden bg-black border transition-all duration-200 flex items-center justify-center select-none',
        isSidebar
          ? 'w-44 sm:w-52 lg:w-full aspect-video rounded-2xl shrink-0'
          : 'w-full h-full min-h-[260px] sm:min-h-[360px] rounded-3xl',
        onSelect && 'cursor-pointer hover:border-indigo-400/75',
        isSelected
          ? 'border-[#6163F6] ring-2 ring-[#6163F6]/50'
          : 'border-[#4D4CEF]/45'
      )}
    >
      <VideoTrack trackRef={trackRef} className="w-full h-full object-contain" />

      {/* Top Overlay on Sidebar Screen-Share Thumbnail */}
      {isSidebar && onSelect && (
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-black/75 border border-white/15 text-[10px] font-semibold text-white inline-flex items-center gap-1">
          <Maximize2 className="h-2.5 w-2.5" />
          Expand
        </div>
      )}

      {/* Presenter Attribution Overlay */}
      <div
        className={cn(
          'absolute flex items-center gap-1.5 rounded-full bg-black/75 backdrop-blur-md border border-white/15 pointer-events-none',
          isSidebar
            ? 'bottom-1.5 left-1.5 right-1.5 px-2 py-0.5 text-[10px]'
            : 'bottom-3 left-3 px-3 py-1.5 text-xs'
        )}
      >
        <MonitorUp className={cn('text-indigo-400 shrink-0', isSidebar ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        <span className="font-semibold text-white truncate">
          {isSidebar
            ? `${isLocalPresenter ? 'Your' : presenterName} screen`
            : `${isLocalPresenter ? 'You are' : `${presenterName} is`} sharing screen`}
        </span>
      </div>
    </div>
  )
}
