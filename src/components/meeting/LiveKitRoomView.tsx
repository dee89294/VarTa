/**
 * File: src/components/meeting/LiveKitRoomView.tsx
 * Purpose: Real-time audio/video meeting room powered by official LiveKit Cloud SDK
 *   (`@livekit/components-react` + `livekit-client`). Supports dynamic Screen Share Mode,
 *   Click-to-Focus Mode, responsive Collage Gallery Mode, real-time active speaker highlights,
 *   waiting room admission/removal, Leave Meeting, and Organizer End Meeting.
 *
 * View Architecture:
 *   - Uses a single `<LiveKitRoom>` + `<RoomAudioRenderer />` connection at all times.
 *   - Changing between Focus, Gallery, and Screen Share layouts only alters UI container
 *     placement — it never unsubscribes tracks or reconnects LiveKit media sessions.
 *
 * Connected files:
 *   - `src/pages/MeetingRoomPage.tsx` (supplies LiveKit JWT, serverUrl, and lifecycle callbacks)
 *   - `src/components/meeting/MeetingStageTiles.tsx` (video, screen-share, speaker, and role tiles)
 *   - `supabase/functions/get-livekit-token/index.ts` (admit/remove/leave/end endpoints)
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  isTrackReference,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import '@livekit/components-styles'
import {
  Check,
  Copy,
  LayoutGrid,
  Maximize2,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Power,
  Share2,
  UserCheck,
  UserMinus,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react'
import { invokeEdgeFunction, supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'
import { Avatar } from '../ui/Avatar'
import {
  MeetingParticipantTile,
  MeetingScreenShareTile,
  RoleTag,
  parseParticipantRole,
} from './MeetingStageTiles'
import type { MeetingParticipant } from '../../types/database'

/** Three supported viewing modes matching top header controls. */
export type MeetingViewMode = 'gallery' | 'focus' | 'screen_share'

/** Tracks which stream occupies the primary viewing area in Focus / Screen Share mode. */
type FocusedTarget =
  | { kind: 'screen'; participantIdentity: string }
  | { kind: 'participant'; participantIdentity: string }

interface LiveKitRoomViewProps {
  serverUrl: string
  token: string
  meetingId: string
  meetingCode: string
  meetingTitle: string
  shareUrl?: string | null
  isOrganizer: boolean
  initialAudio: boolean
  initialVideo: boolean
  onLeave: () => void
  onEndMeeting: () => Promise<void>
  onDisconnectedByServer: () => void
}

/**
 * Computes balanced equal-tile responsive grid classes for Gallery Mode
 * based on total active participant count (`1, 2, 3-4, 5-6, 7-9, 10+`).
 */
function getGalleryGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 max-w-5xl mx-auto my-auto [&>*]:h-auto [&>*]:aspect-video [&>*]:max-h-[74vh]'
  if (count === 2) return 'grid-cols-1 md:grid-cols-2 max-w-6xl mx-auto my-auto md:[&>*]:h-auto md:[&>*]:aspect-video md:[&>*]:max-h-[68vh]'
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2 sm:h-full auto-rows-fr'
  if (count <= 6) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 lg:h-full auto-rows-fr'
  if (count <= 9) return 'grid-cols-2 sm:grid-cols-3 sm:h-full auto-rows-fr'
  return 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 auto-rows-[minmax(180px,1fr)]'
}

/**
 * Inner room controller rendered inside `<LiveKitRoom>`.
 * Reads real-time participant, active speaker, camera, and screen-share state directly from
 * LiveKit hooks (`useParticipants`, `useTracks`, `useLocalParticipant`, `useRoomContext`).
 */
function LiveKitStageInner({
  meetingId,
  meetingCode,
  meetingTitle,
  shareUrl,
  isOrganizer,
  leavingBySelfRef,
  onLeave,
  onEndMeeting,
}: {
  meetingId: string
  meetingCode: string
  meetingTitle: string
  shareUrl?: string | null
  isOrganizer: boolean
  leavingBySelfRef: MutableRefObject<boolean>
  onLeave: () => void
  onEndMeeting: () => Promise<void>
}) {
  const { toast } = useToast()
  const room = useRoomContext()
  const participants = useParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant()

  // Real-time LiveKit screen-share publications (both local presenter and remote viewers)
  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  }).filter(isTrackReference)

  // Real-time camera publications + placeholders for camera-off participants
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  })

  const [viewMode, setViewMode] = useState<MeetingViewMode>('gallery')
  const [focusedTarget, setFocusedTarget] = useState<FocusedTarget | null>(null)
  const prevScreenCountRef = useRef(0)

  const [panelOpen, setPanelOpen] = useState(false)
  const [waitingQueue, setWaitingQueue] = useState<MeetingParticipant[]>([])
  const [dbParticipants, setDbParticipants] = useState<MeetingParticipant[]>([])
  const [copiedLink, setCopiedLink] = useState(false)
  const [ending, setEnding] = useState(false)
  const [busyControl, setBusyControl] = useState(false)

  // Map of participant identities currently sharing their screen for quick lookup in tiles
  const screenSharingIdentities = useMemo(
    () => new Set(screenTracks.map((t) => t.participant.identity)),
    [screenTracks]
  )

  /**
   * Handles automatic LiveKit Screen Share view transitions:
   * - Starting a screen share (`0 -> >0` tracks) automatically switches to Screen Share View.
   * - Stopping all screen shares (`>0 -> 0` tracks) automatically returns to Gallery View
   *   unless the user explicitly focused a participant camera or manually stayed in Gallery.
   */
  useEffect(() => {
    const prevCount = prevScreenCountRef.current
    const currCount = screenTracks.length
    prevScreenCountRef.current = currCount

    if (prevCount === 0 && currCount > 0) {
      setViewMode('screen_share')
      setFocusedTarget({
        kind: 'screen',
        participantIdentity: screenTracks[0].participant.identity,
      })
      return
    }

    if (prevCount > 0 && currCount === 0) {
      setFocusedTarget((prevTarget) => {
        if (prevTarget?.kind === 'participant') return prevTarget
        return null
      })
      setViewMode((prevMode) => (prevMode === 'screen_share' ? 'gallery' : prevMode))
      return
    }

    // If multiple screen shares existed and the focused screen share stopped while another continues
    if (
      currCount > 0 &&
      viewMode === 'screen_share' &&
      focusedTarget?.kind === 'screen' &&
      !screenTracks.some((t) => t.participant.identity === focusedTarget.participantIdentity)
    ) {
      setFocusedTarget({
        kind: 'screen',
        participantIdentity: screenTracks[0].participant.identity,
      })
    }
  }, [screenTracks, viewMode, focusedTarget])

  // Graceful fallback if the focused participant disconnects from the meeting
  useEffect(() => {
    if (focusedTarget?.kind !== 'participant') return
    const stillPresent = cameraTracks.some((t) => t.participant.identity === focusedTarget.participantIdentity)
    if (!stillPresent) {
      if (screenTracks.length > 0) {
        setViewMode('screen_share')
        setFocusedTarget({
          kind: 'screen',
          participantIdentity: screenTracks[0].participant.identity,
        })
      } else {
        setViewMode('gallery')
        setFocusedTarget(null)
      }
    }
  }, [cameraTracks, screenTracks, focusedTarget])

  // Organizer monitors waiting queue and participant IDs for admission/removal
  useEffect(() => {
    if (!isOrganizer) return

    const loadDbParticipants = async () => {
      const { data } = await supabase
        .from('meeting_participants')
        .select('id, meeting_id, user_id, full_name, email, participant_type, participant_identity, admission_status, joined_at, left_at')
        .eq('meeting_id', meetingId)
      const list = (data ?? []) as MeetingParticipant[]
      setDbParticipants(list)
      setWaitingQueue(list.filter((p) => p.admission_status === 'waiting'))
    }

    loadDbParticipants()
    const ch = supabase
      .channel(`lk-org-participants-${meetingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_participants', filter: `meeting_id=eq.${meetingId}` },
        () => loadDbParticipants()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [isOrganizer, meetingId])

  /** Focuses any participant camera tile into the main stage without dropping media tracks. */
  const handleSelectParticipant = (participantIdentity: string) => {
    setFocusedTarget({ kind: 'participant', participantIdentity })
    setViewMode('focus')
  }

  /** Returns any active shared screen (or first active screen share) to the primary stage. */
  const handleSelectScreenShare = (participantIdentity?: string) => {
    const targetTrack = participantIdentity
      ? screenTracks.find((t) => t.participant.identity === participantIdentity) ?? screenTracks[0]
      : screenTracks[0]
    if (!targetTrack) return
    setFocusedTarget({
      kind: 'screen',
      participantIdentity: targetTrack.participant.identity,
    })
    setViewMode('screen_share')
  }

  /** Handles clicks on the 3 header view controls: Focus, Gallery, and Screen Share. */
  const handleSwitchViewMode = (nextMode: MeetingViewMode) => {
    if (nextMode === 'gallery') {
      setViewMode('gallery')
      return
    }

    if (nextMode === 'screen_share') {
      if (screenTracks.length > 0) {
        handleSelectScreenShare(
          focusedTarget?.kind === 'screen' ? focusedTarget.participantIdentity : undefined
        )
      }
      return
    }

    // Switching to Focus View: preserve focused participant if still present, else pick speaker / remote / local
    if (
      focusedTarget?.kind === 'participant' &&
      cameraTracks.some((t) => t.participant.identity === focusedTarget.participantIdentity)
    ) {
      setViewMode('focus')
      return
    }

    const activeSpeakerTrack =
      cameraTracks.find((t) => t.participant.isSpeaking && !t.participant.isLocal) ??
      cameraTracks.find((t) => !t.participant.isLocal) ??
      cameraTracks[0]

    if (activeSpeakerTrack) {
      setFocusedTarget({
        kind: 'participant',
        participantIdentity: activeSpeakerTrack.participant.identity,
      })
      setViewMode('focus')
    }
  }

  const handleToggleMic = async () => {
    if (busyControl) return
    setBusyControl(true)
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch (err) {
      toast({
        type: 'error',
        title: 'Microphone Error',
        description: err instanceof Error ? err.message : 'Check browser microphone permission.',
      })
    } finally {
      setBusyControl(false)
    }
  }

  const handleToggleCam = async () => {
    if (busyControl) return
    setBusyControl(true)
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled)
    } catch (err) {
      toast({
        type: 'error',
        title: 'Camera Error',
        description: err instanceof Error ? err.message : 'Check browser camera permission.',
      })
    } finally {
      setBusyControl(false)
    }
  }

  const handleToggleScreenShare = async () => {
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled)
    } catch (err) {
      toast({
        type: 'warning',
        title: 'Screen Share Cancelled',
        description: err instanceof Error ? err.message : 'Screen sharing permission denied.',
      })
    }
  }

  const handleCopyInvite = async () => {
    let urlToCopy = shareUrl || `${window.location.origin}/meeting/${meetingCode}`
    if (!shareUrl && isOrganizer) {
      try {
        const res = await invokeEdgeFunction<{ share_url: string }>('meeting-invitations', {
          action: 'get_share_link',
          meeting_id: meetingId,
        })
        urlToCopy = res.share_url
      } catch {
        // fallback cleanly
      }
    }
    try {
      await navigator.clipboard.writeText(urlToCopy)
      setCopiedLink(true)
      toast({ type: 'success', title: 'Meeting Link Copied' })
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      toast({ type: 'error', title: 'Clipboard blocked' })
    }
  }

  const handleAdmit = async (participantId: string) => {
    try {
      await invokeEdgeFunction('get-livekit-token', {
        action: 'admit_participant',
        meeting_id: meetingId,
        target_participant_id: participantId,
      })
      toast({ type: 'success', title: 'Participant Admitted' })
    } catch (err) {
      toast({ type: 'error', title: 'Could not admit', description: err instanceof Error ? err.message : 'Error' })
    }
  }

  const handleRemoveParticipant = async (participantId: string) => {
    try {
      await invokeEdgeFunction('get-livekit-token', {
        action: 'remove_participant',
        meeting_id: meetingId,
        target_participant_id: participantId,
      })
      toast({ type: 'info', title: 'Participant Removed' })
    } catch (err) {
      toast({ type: 'error', title: 'Could not remove', description: err instanceof Error ? err.message : 'Error' })
    }
  }

  const handleLeaveClick = () => {
    leavingBySelfRef.current = true
    room.disconnect()
    onLeave()
  }

  const handleEndClick = async () => {
    if (!isOrganizer || ending) return
    if (!window.confirm('End this meeting for all participants?')) return
    setEnding(true)
    try {
      await onEndMeeting()
    } finally {
      setEnding(false)
    }
  }

  // Resolve primary stage item and sidebar thumbnails when in `screen_share` or `focus` layout
  const mainScreenTrack =
    viewMode === 'screen_share' && screenTracks.length > 0
      ? screenTracks.find(
          (t) => focusedTarget?.kind === 'screen' && t.participant.identity === focusedTarget.participantIdentity
        ) ?? screenTracks[0]
      : null

  const mainParticipantTrack =
    viewMode === 'focus'
      ? cameraTracks.find(
          (t) => focusedTarget?.kind === 'participant' && t.participant.identity === focusedTarget.participantIdentity
        ) ?? cameraTracks[0] ?? null
      : null

  // Sidebar displays any non-main screen shares first, followed by remaining participants
  const sidebarScreenTracks = mainScreenTrack
    ? screenTracks.filter((t) => t.participant.identity !== mainScreenTrack.participant.identity)
    : viewMode === 'focus'
      ? screenTracks
      : []

  const sidebarParticipantTracks = mainParticipantTrack
    ? cameraTracks.filter((t) => t.participant.identity !== mainParticipantTrack.participant.identity)
    : cameraTracks

  const hasSidebarItems = sidebarScreenTracks.length > 0 || sidebarParticipantTracks.length > 0
  const hasActiveScreenShare = screenTracks.length > 0

  return (
    <div className="h-[100dvh] w-full bg-[#10121A] text-white flex flex-col overflow-hidden">
      {/* Persistent audio renderer across all view transitions */}
      <RoomAudioRenderer />

      {/* Top Header + View Switcher */}
      <header className="px-3 sm:px-6 py-2.5 bg-[#151824]/95 border-b border-white/10 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center font-display font-extrabold text-sm shrink-0">
            V
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-sm sm:text-base font-bold truncate">{meetingTitle}</h1>
            <p className="text-[11px] font-mono text-indigo-300 truncate">{meetingCode}</p>
          </div>
        </div>

        {/* Dedicated View Switching Controls: Focus, Gallery, Screen Share */}
        <nav
          aria-label="Meeting layout views"
          className="order-3 md:order-2 w-full md:w-auto flex items-center justify-center gap-1 p-1 rounded-full bg-white/6 border border-white/10"
        >
          <button
            type="button"
            onClick={() => handleSwitchViewMode('focus')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer',
              viewMode === 'focus'
                ? 'bg-[#4D4CEF] text-white shadow-sm'
                : 'text-white/75 hover:text-white hover:bg-white/10'
            )}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span>Focus View</span>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchViewMode('gallery')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer',
              viewMode === 'gallery'
                ? 'bg-[#4D4CEF] text-white shadow-sm'
                : 'text-white/75 hover:text-white hover:bg-white/10'
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Gallery View</span>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchViewMode('screen_share')}
            disabled={!hasActiveScreenShare}
            title={
              hasActiveScreenShare
                ? 'Switch to Screen Share View'
                : 'Screen Share View unlocks when someone shares their screen'
            }
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
              !hasActiveScreenShare && 'opacity-45 cursor-not-allowed text-white/50',
              hasActiveScreenShare && 'cursor-pointer',
              viewMode === 'screen_share'
                ? 'bg-[#4D4CEF] text-white shadow-sm'
                : hasActiveScreenShare
                  ? 'text-emerald-300 hover:text-white hover:bg-white/10'
                  : ''
            )}
          >
            <MonitorUp className="h-3.5 w-3.5" />
            <span>Screen Share View</span>
            {hasActiveScreenShare && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        </nav>

        <div className="order-2 md:order-3 flex items-center gap-2">
          <StartAudio
            label="Enable Room Audio"
            className="px-3 py-1.5 rounded-full bg-amber-500 text-black text-xs font-bold"
          />

          {isOrganizer && waitingQueue.length > 0 && (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-200 text-xs font-semibold animate-pulse cursor-pointer"
            >
              {waitingQueue.length} Waiting
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyInvite}
            className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold transition-colors cursor-pointer"
          >
            {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedLink ? 'Copied' : 'Copy Link'}
          </button>

          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer',
              panelOpen ? 'bg-[#4D4CEF] text-white' : 'bg-white/10 hover:bg-white/15 text-white'
            )}
          >
            <Users className="h-3.5 w-3.5" />
            <span>{participants.length}</span>
          </button>
        </div>
      </header>

      {/* Primary Stage + Right-Side/Bottom Participant Sidebar + Optional Participants Drawer */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 p-3 sm:p-4 flex flex-col overflow-hidden">
          {viewMode === 'gallery' ? (
            /* Collage Gallery Mode: responsive balanced grid across all connected participants */
            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 flex flex-col">
              <div className={cn('grid gap-3 w-full', getGalleryGridClass(cameraTracks.length))}>
                {cameraTracks.map((trackRef) => (
                  <MeetingParticipantTile
                    key={`gallery-${trackRef.participant.identity}`}
                    trackRef={trackRef}
                    variant="gallery"
                    isSharingScreen={screenSharingIdentities.has(trackRef.participant.identity)}
                    onSelect={() => handleSelectParticipant(trackRef.participant.identity)}
                    onJumpToScreenShare={
                      screenSharingIdentities.has(trackRef.participant.identity)
                        ? () => handleSelectScreenShare(trackRef.participant.identity)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ) : (
            /* Focus / Screen Share Layout: large main stage + scrollable participant sidebar */
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 overflow-hidden">
              {/* Main Large Viewing Area */}
              <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center">
                {mainScreenTrack ? (
                  <MeetingScreenShareTile
                    key={`main-screen-${mainScreenTrack.participant.identity}`}
                    trackRef={mainScreenTrack}
                    variant="main"
                    isSelected
                  />
                ) : mainParticipantTrack ? (
                  <MeetingParticipantTile
                    key={`main-cam-${mainParticipantTrack.participant.identity}`}
                    trackRef={mainParticipantTrack}
                    variant="main"
                    isSelected
                    isSharingScreen={screenSharingIdentities.has(mainParticipantTrack.participant.identity)}
                    onJumpToScreenShare={
                      screenSharingIdentities.has(mainParticipantTrack.participant.identity)
                        ? () => handleSelectScreenShare(mainParticipantTrack.participant.identity)
                        : undefined
                    }
                  />
                ) : null}
              </div>

              {/* Vertical Desktop Sidebar / Compact Horizontal Mobile & Tablet Strip */}
              {hasSidebarItems && (
                <aside
                  aria-label="Participant thumbnails"
                  className="lg:w-72 xl:w-80 shrink-0 min-h-0 flex flex-row lg:flex-col gap-2.5 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto pb-1 lg:pb-0 lg:pr-1"
                >
                  {sidebarScreenTracks.map((screenTrack) => (
                    <MeetingScreenShareTile
                      key={`side-screen-${screenTrack.participant.identity}`}
                      trackRef={screenTrack}
                      variant="sidebar"
                      onSelect={() => handleSelectScreenShare(screenTrack.participant.identity)}
                    />
                  ))}

                  {sidebarParticipantTracks.map((trackRef) => (
                    <MeetingParticipantTile
                      key={`side-cam-${trackRef.participant.identity}`}
                      trackRef={trackRef}
                      variant="sidebar"
                      isSharingScreen={screenSharingIdentities.has(trackRef.participant.identity)}
                      onSelect={() => handleSelectParticipant(trackRef.participant.identity)}
                    />
                  ))}
                </aside>
              )}
            </div>
          )}
        </div>

        {/* Participants Side Drawer (Invite Links + Waiting Room Approvals + Participant List) */}
        {panelOpen && (
          <aside className="absolute inset-y-0 right-0 z-20 w-80 max-w-full lg:static bg-[#161926] border-l border-white/10 flex flex-col">
            <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between">
              <h2 className="font-display text-sm font-bold">Participants ({participants.length})</h2>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/70 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Quick Link Copy */}
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                <p className="text-[11px] font-semibold text-white/75">Invite Link</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Link
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = shareUrl || `${window.location.origin}/meeting/${meetingCode}`
                      window.open(
                        `https://wa.me/?text=${encodeURIComponent(`Join "${meetingTitle}" on VARTA: ${url}`)}`,
                        '_blank',
                        'noopener,noreferrer'
                      )
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold cursor-pointer"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    WhatsApp
                  </button>
                </div>
              </div>

              {/* Organizer Waiting Room Approvals */}
              {isOrganizer && waitingQueue.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    Waiting Room ({waitingQueue.length})
                  </p>
                  {waitingQueue.map((wp) => (
                    <div
                      key={wp.id}
                      className="p-3 rounded-2xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{wp.full_name}</p>
                        <p className="text-[10px] text-white/60 capitalize">{wp.participant_type}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleAdmit(wp.id)}
                          className="px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <UserCheck className="h-3 w-3" /> Admit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveParticipant(wp.id)}
                          className="p-1 rounded-full bg-rose-500/20 text-rose-300 hover:bg-rose-500 hover:text-white cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Connected Participants List (clicking focuses participant immediately) */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">In This Meeting</p>
                {participants.map((p) => {
                  const roleType = parseParticipantRole(p)
                  const dbRow = dbParticipants.find((row) => row.participant_identity === p.identity)
                  const isFocusedParticipant =
                    viewMode === 'focus' && focusedTarget?.kind === 'participant' && focusedTarget.participantIdentity === p.identity
                  return (
                    <div
                      key={p.identity}
                      onClick={() => handleSelectParticipant(p.identity)}
                      className={cn(
                        'p-2.5 rounded-2xl border flex items-center justify-between gap-2 cursor-pointer transition-colors',
                        isFocusedParticipant
                          ? 'bg-[#4D4CEF]/20 border-[#6163F6]/60'
                          : 'bg-white/5 border-white/10 hover:bg-white/10'
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={p.name || p.identity} size="sm" shape="circle" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold truncate">
                              {p.name || p.identity}
                              {p.isLocal ? ' (You)' : ''}
                            </p>
                            <RoleTag type={roleType} />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {screenSharingIdentities.has(p.identity) && (
                          <MonitorUp className="h-3.5 w-3.5 text-emerald-400" />
                        )}
                        {p.isMicrophoneEnabled ? (
                          <Mic className="h-3.5 w-3.5 text-indigo-300" />
                        ) : (
                          <MicOff className="h-3.5 w-3.5 text-rose-400" />
                        )}
                        {isOrganizer && !p.isLocal && dbRow && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveParticipant(dbRow.id)
                            }}
                            title="Remove participant"
                            className="p-1 rounded-full hover:bg-rose-500/20 text-white/60 hover:text-rose-300 cursor-pointer"
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Consistent Bottom Controls Bar Across All Layouts */}
      <footer className="px-4 py-3 bg-[#151824]/95 border-t border-white/10 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 shrink-0">
        <button
          type="button"
          onClick={handleToggleMic}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold transition-all cursor-pointer',
            isMicrophoneEnabled
              ? 'bg-white/12 hover:bg-white/20 text-white'
              : 'bg-rose-600 hover:bg-rose-700 text-white'
          )}
        >
          {isMicrophoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          <span className="hidden sm:inline">{isMicrophoneEnabled ? 'Mute' : 'Unmute'}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleCam}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold transition-all cursor-pointer',
            isCameraEnabled
              ? 'bg-white/12 hover:bg-white/20 text-white'
              : 'bg-rose-600 hover:bg-rose-700 text-white'
          )}
        >
          {isCameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          <span className="hidden sm:inline">{isCameraEnabled ? 'Camera On' : 'Camera Off'}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleScreenShare}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold transition-all cursor-pointer',
            isScreenShareEnabled
              ? 'bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white'
              : 'bg-white/12 hover:bg-white/20 text-white'
          )}
        >
          {isScreenShareEnabled ? <MonitorOff className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}
          <span className="hidden sm:inline">{isScreenShareEnabled ? 'Stop Share' : 'Share Screen'}</span>
        </button>

        <button
          type="button"
          onClick={handleLeaveClick}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white cursor-pointer"
        >
          <PhoneOff className="h-4 w-4" />
          Leave Meeting
        </button>

        {isOrganizer && (
          <button
            type="button"
            onClick={handleEndClick}
            disabled={ending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#111218] hover:bg-rose-950 border border-rose-500/60 text-xs font-semibold text-rose-200 cursor-pointer"
          >
            <Power className="h-4 w-4 text-rose-400" />
            {ending ? 'Ending...' : 'End Meeting'}
          </button>
        )}
      </footer>
    </div>
  )
}

export function LiveKitRoomView({
  serverUrl,
  token,
  meetingId,
  meetingCode,
  meetingTitle,
  shareUrl,
  isOrganizer,
  initialAudio,
  initialVideo,
  onLeave,
  onEndMeeting,
  onDisconnectedByServer,
}: LiveKitRoomViewProps) {
  const { toast } = useToast()
  const leavingBySelfRef = useRef(false)

  useEffect(() => {
    leavingBySelfRef.current = false
  }, [token])

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect={true}
      audio={initialAudio}
      video={initialVideo}
      onDisconnected={() => {
        if (!leavingBySelfRef.current) {
          onDisconnectedByServer()
        }
      }}
      onError={(err) => {
        toast({
          type: 'error',
          title: 'LiveKit Connection Issue',
          description: err.message,
        })
      }}
    >
      <LiveKitStageInner
        meetingId={meetingId}
        meetingCode={meetingCode}
        meetingTitle={meetingTitle}
        shareUrl={shareUrl}
        isOrganizer={isOrganizer}
        leavingBySelfRef={leavingBySelfRef}
        onLeave={onLeave}
        onEndMeeting={onEndMeeting}
      />
    </LiveKitRoom>
  )
}
