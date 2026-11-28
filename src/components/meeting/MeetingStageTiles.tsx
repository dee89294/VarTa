/**
 * File: src/components/meeting/MeetingStageTiles.tsx
 * Purpose: Reusable dark-theme LiveKit video, screen-share, and thumbnail tile components
 *   used across Focus, Gallery, and Screen Share layouts inside `LiveKitRoomView.tsx`.
 * Features:
 *   - Real-time active speaker detection via LiveKit's `useIsSpeaking()` hook.
 *   - Camera-off Avatar fallback, muted/unmuted mic status pill, and Host/Guest role badge.
 *   - Seamless full-stage mode (`isFullStage`) for immersive edge-to-edge video conferencing.
 *   - Aspect-preserving (`object-contain`) centered rendering on shared screen tiles.
 *   - Instant click-to-focus selection without unsubscribing or reconnecting LiveKit tracks.
 * Connected files:
 *   - `src/components/meeting/LiveKitRoomView.tsx` (orchestrates layout modes, controls, and clicks)
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
      <span className="px-2 py-0.5 rounded-full bg-[#9C65E5]/30 text-purple-100 text-[10px] font-semibold shrink-0">
        Guest
      </span>
    )
  }
  return null
}

export interface MeetingParticipantTileProps {
  /** LiveKit camera track reference or placeholder for a connected participant. */
  trackRef: TrackReferenceOrPlaceholder
  /** Display density variant depending on main stage, gallery cell, or compact floating thumbnail. */
  variant: 'gallery' | 'main' | 'sidebar'
  /** Expands tile seamlessly across the full viewport container without inner border/radius. */
  isFullStage?: boolean
  /** Mirrors local self-view video horizontally when enabled. */
  mirrorLocal?: boolean
  /** Raises bottom overlay badge on small screens when floating toolbar is visible. */
  avoidBottomToolbar?: boolean
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
  isFullStage = false,
  mirrorLocal = true,
  avoidBottomToolbar = false,
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
  const isMain = variant === 'main' || isFullStage

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
        'group relative overflow-hidden bg-[#08090F] transition-all duration-200 flex items-center justify-center select-none',
        isFullStage
          ? 'w-full h-full rounded-none border-0'
          : isMain
            ? 'w-full h-full rounded-2xl border'
            : variant === 'gallery'
              ? 'w-full h-full min-h-[150px] rounded-2xl border'
              : 'w-36 sm:w-44 aspect-video rounded-2xl border shadow-[0_14px_34px_-10px_rgba(0,0,0,0.85)] shrink-0',
        onSelect && !isFullStage && 'cursor-pointer hover:border-indigo-400/70',
        !isFullStage &&
          (isSelected
            ? 'border-[#6163F6] ring-2 ring-[#6163F6]/60 shadow-[0_0_24px_-6px_rgba(97,99,246,0.55)]'
            : isSpeaking
              ? 'border-emerald-400/80 ring-2 ring-emerald-400/45 shadow-[0_0_22px_-6px_rgba(52,211,153,0.5)]'
              : 'border-white/12')
      )}
    >
      {hasLiveVideo && isTrackReference(trackRef) ? (
        <VideoTrack
          trackRef={trackRef}
          className={cn(
            'w-full h-full',
            isFullStage || isMain ? 'object-contain bg-[#050609]' : 'object-cover',
            isLocal && mirrorLocal && 'scale-x-[-1]'
          )}
        />
      ) : (
        <div
          className={cn(
            'w-full h-full flex flex-col items-center justify-center',
            isFullStage
              ? 'bg-[#050609]'
              : 'bg-gradient-to-br from-[#141726] via-[#0D101B] to-[#080A11]',
            isSidebar ? 'gap-1 p-2' : 'gap-3 p-4'
          )}
        >
          <Avatar
            name={displayName}
            size={isFullStage || isMain ? 'xl' : isSidebar ? 'sm' : 'lg'}
            shape="circle"
            className={cn(
              'ring-4 transition-all',
              isSpeaking ? 'ring-emerald-400/70 scale-105' : 'ring-white/10'
            )}
          />
          {!isSidebar && !isFullStage && (
            <span className="text-[11px] font-medium text-white/45">Camera off</span>
          )}
        </div>
      )}

      {/* Top Badges: Active Speaker / Screen Share Indicator / Focus Hint */}
      <div
        className={cn(
          'absolute flex items-center justify-between gap-2 pointer-events-none',
          isFullStage ? 'top-4 left-4 right-4' : isSidebar ? 'top-1.5 left-1.5 right-1.5' : 'top-3 left-3 right-3'
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isSpeaking && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/90 text-black text-[10px] font-bold shadow-sm">
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
                'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#4D4CEF]/90 text-white text-[10px] font-semibold border border-indigo-300/30',
                onJumpToScreenShare && 'pointer-events-auto hover:bg-[#3F41E2] cursor-pointer'
              )}
              title={onJumpToScreenShare ? 'Switch to Screen Share View' : 'Sharing screen'}
            >
              <MonitorUp className="h-3 w-3 shrink-0" />
              {!isSidebar && <span>Sharing screen</span>}
            </button>
          )}
        </div>

        {onSelect && !isMain && !isFullStage && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-black/75 border border-white/15 text-[10px] font-semibold text-white/90 inline-flex items-center gap-1 shrink-0">
            <Maximize2 className="h-2.5 w-2.5" />
            {!isSidebar && 'Focus'}
          </span>
        )}
      </div>

      {/* Bottom Name, Role Tag, and Mic Status */}
      <div
        className={cn(
          'absolute flex items-center justify-between gap-2 pointer-events-none transition-all duration-200',
          isFullStage
            ? cn(
                'left-4 sm:left-5 right-4 sm:right-auto',
                avoidBottomToolbar ? 'bottom-24 md:bottom-5' : 'bottom-5'
              )
            : isSidebar
              ? 'bottom-1.5 left-1.5 right-1.5'
              : 'bottom-3 left-3 right-3'
        )}
      >
        <div
          className={cn(
            'inline-flex items-center gap-2 rounded-full bg-[#11131E]/85 backdrop-blur-md border border-white/10 min-w-0',
            isFullStage ? 'px-3 py-1.5 max-w-[85vw] sm:max-w-[320px]' : isSidebar ? 'px-2 py-0.5 max-w-[78%]' : 'px-3 py-1 max-w-[82%]'
          )}
        >
          <span className={cn('font-semibold text-white truncate', isSidebar ? 'text-[10px]' : 'text-xs')}>
            {displayName}
            {isLocal ? ' (You)' : ''}
          </span>
          {!isSidebar && <RoleTag type={roleType} />}
          {isFullStage && !isMicOn && (
            <MicOff className="h-3 w-3 text-rose-400 shrink-0" aria-label="Muted" />
          )}
        </div>

        {!isFullStage && (
          <span
            className={cn(
              'rounded-full flex items-center justify-center shrink-0 border border-white/10',
              isSidebar ? 'h-5 w-5' : 'h-7 w-7',
              isMicOn
                ? isSpeaking
                  ? 'bg-emerald-500 text-black'
                  : 'bg-[#161926]/85 text-white/85'
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
        )}
      </div>
    </div>
  )
}

export interface MeetingScreenShareTileProps {
  /** LiveKit `Track.Source.ScreenShare` track reference. */
  trackRef: TrackReference
  /** Whether rendered on the full stage or as a compact clickable floating thumbnail. */
  variant: 'main' | 'sidebar'
  /** Highlights tile if selected. */
  isSelected?: boolean
  /** Raises bottom presenter label cleanly when floating toolbar is visible. */
  avoidBottomToolbar?: boolean
  /** Triggered when clicking a floating screen-share thumbnail to bring it back to main view. */
  onSelect?: () => void
}

/**
 * Renders an active LiveKit screen share centered without aspect distortion (`object-contain`),
 * both for full-stage presentation and as a clickable floating thumbnail when another participant is focused.
 */
export function MeetingScreenShareTile({
  trackRef,
  variant,
  isSelected = false,
  avoidBottomToolbar = false,
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
        'group relative overflow-hidden bg-[#050609] transition-all duration-200 flex items-center justify-center select-none',
        isSidebar
          ? 'w-36 sm:w-44 aspect-video rounded-2xl border shadow-[0_14px_34px_-10px_rgba(0,0,0,0.85)] shrink-0'
          : 'w-full h-full rounded-none border-0',
        onSelect && isSidebar && 'cursor-pointer hover:border-indigo-400/75',
        isSidebar && (isSelected ? 'border-[#6163F6] ring-2 ring-[#6163F6]/50' : 'border-[#4D4CEF]/50')
      )}
    >
      <VideoTrack trackRef={trackRef} className="w-full h-full object-contain" />

      {/* Top Overlay on Floating Screen-Share Thumbnail */}
      {isSidebar && onSelect && (
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-black/75 border border-white/15 text-[10px] font-semibold text-white inline-flex items-center gap-1">
          <Maximize2 className="h-2.5 w-2.5" />
          Expand
        </div>
      )}

      {/* Presenter Attribution Overlay */}
      <div
        className={cn(
          'absolute flex items-center gap-1.5 rounded-full bg-[#11131E]/85 backdrop-blur-md border border-white/10 pointer-events-none transition-all duration-200',
          isSidebar
            ? 'bottom-1.5 left-1.5 right-1.5 px-2 py-0.5 text-[10px]'
            : cn('left-4 sm:left-5 px-3 py-1.5 text-xs', avoidBottomToolbar ? 'bottom-24 md:bottom-5' : 'bottom-5')
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
