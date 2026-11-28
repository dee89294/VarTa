/**
 * File: src/components/meeting/LiveKitRoomView.tsx
 * Purpose: Full-screen immersive LiveKit Cloud video meeting interface (`100dvh` x `100vw`).
 *   Maximizes screen space for video conferencing by removing the permanent top header and
 *   moving all secondary controls (Chat, Participants, Add/Invite, Layout, More Settings,
 *   Copy Link, Leave, and Host End Meeting) into smart auto-hiding floating bubble controls
 *   and glassmorphic floating panels.
 *
 * View Architecture:
 *   - Uses a single `<LiveKitRoom>` + `<RoomAudioRenderer />` connection at all times.
 *   - Switching between Focus, Gallery, and Screen Share layouts or opening/closing floating
 *     panels never unmounts LiveKit tracks or reconnects media sessions.
 *   - Smart Inactivity: Floating toolbar auto-fades after 4s of inactivity and reappears on
 *     mouse move, touch, or key input; remains pinned when hovering controls, opening panels,
 *     or when urgent waiting-room alerts are present.
 *
 * Connected files:
 *   - `src/pages/MeetingRoomPage.tsx` (supplies LiveKit JWT, serverUrl, tokens, and callbacks)
 *   - `src/components/meeting/MeetingStageTiles.tsx` (video & screen-share tile renderers)
 *   - `src/components/meeting/FloatingMeetingPanels.tsx` (floating Chat, Participants, Add, Layout, Settings)
 *   - `supabase/functions/get-livekit-token/index.ts` (chat, waiting room, remove, leave, end actions)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
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
import { RoomEvent, Track } from 'livekit-client'
import '@livekit/components-styles'
import {
  Check,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Power,
  UserPlus,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react'
import { invokeEdgeFunction, supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'
import { Avatar } from '../ui/Avatar'
import { MeetingParticipantTile, MeetingScreenShareTile } from './MeetingStageTiles'
import {
  FloatingAddParticipantsPanel,
  FloatingChatPanel,
  FloatingParticipantsPanel,
  LayoutPopover,
  MoreSettingsPopover,
  type FloatingChatMessage,
  type MeetingViewMode,
} from './FloatingMeetingPanels'
import type { MeetingParticipant } from '../../types/database'

export type { MeetingViewMode }

type FocusedTarget =
  | { kind: 'screen'; participantIdentity: string }
  | { kind: 'participant'; participantIdentity: string }

type ActiveRightPanel = 'chat' | 'participants' | 'add' | null
type ActivePopover = 'layout' | 'more' | null

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
  organizerName?: string
  inviteToken?: string
  shareToken?: string
  participantIdentity?: string
  canEditWorkspace?: boolean
  initialSummary?: { description: string; agenda: string; discussion_points: string }
  initialRecordingStatus?: 'idle' | 'recording' | 'paused'
}

/**
 * Computes responsive grid sizing for Gallery View when 2+ participants are connected.
 * When only 1 participant is connected, Gallery View expands edge-to-edge full screen.
 */
function getGalleryGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 h-full'
  if (count === 2) return 'grid-cols-1 md:grid-cols-2 h-full auto-rows-fr'
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2 h-full auto-rows-fr'
  if (count <= 6) return 'grid-cols-2 lg:grid-cols-3 h-full auto-rows-fr'
  if (count <= 9) return 'grid-cols-2 sm:grid-cols-3 h-full auto-rows-fr'
  return 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 auto-rows-[minmax(160px,1fr)]'
}

/** Circular glassmorphism bubble button with hover tooltip for the bottom toolbar. */
function BubbleControlButton({
  label,
  onClick,
  active = false,
  danger = false,
  highlight = false,
  badge,
  pulseDot = false,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  danger?: boolean
  highlight?: boolean
  badge?: number
  pulseDot?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative group/btn">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={cn(
          'relative h-10 w-10 sm:h-11 sm:w-11 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95',
          danger
            ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_6px_18px_rgba(225,29,72,0.4)]'
            : highlight
              ? 'bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white shadow-[0_6px_18px_rgba(77,76,239,0.45)]'
              : active
                ? 'bg-white text-[#121521] shadow-md'
                : 'bg-white/10 hover:bg-white/18 text-white border border-white/8'
        )}
      >
        {children}
        {typeof badge === 'number' && badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#4D4CEF] border border-[#0B0D14] text-[10px] font-bold text-white flex items-center justify-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {pulseDot && (
          <span className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-[#10121C] animate-pulse" />
        )}
      </button>

      {/* Hover Tooltip */}
      <span
        role="tooltip"
        className="pointer-events-none opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 hidden sm:block absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 rounded-lg bg-[#0D101B]/95 border border-white/12 text-[11px] font-medium text-white shadow-lg"
      >
        {label}
      </span>
    </div>
  )
}

/**
 * Inner room controller rendered inside `<LiveKitRoom>`.
 */
function LiveKitStageInner({
  meetingId,
  meetingCode,
  meetingTitle,
  organizerName,
  shareUrl,
  inviteToken = '',
  shareToken = '',
  isOrganizer,
  leavingBySelfRef,
  onLeave,
  onEndMeeting,
  myIdentity,
}: {
  meetingId: string
  meetingCode: string
  meetingTitle: string
  organizerName?: string
  shareUrl?: string | null
  inviteToken?: string
  shareToken?: string
  isOrganizer: boolean
  leavingBySelfRef: MutableRefObject<boolean>
  onLeave: () => void
  onEndMeeting: () => Promise<void>
  myIdentity: string
}) {
  const { toast } = useToast()
  const room = useRoomContext()
  const participants = useParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant()

  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  }).filter(isTrackReference)

  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  })

  const [viewMode, setViewMode] = useState<MeetingViewMode>('gallery')
  const [focusedTarget, setFocusedTarget] = useState<FocusedTarget | null>(null)
  const prevScreenCountRef = useRef(0)

  const [activePanel, setActivePanel] = useState<ActiveRightPanel>(null)
  const [activePopover, setActivePopover] = useState<ActivePopover>(null)
  const [mirrorLocal, setMirrorLocal] = useState(true)

  const [waitingQueue, setWaitingQueue] = useState<MeetingParticipant[]>([])
  const [dbParticipants, setDbParticipants] = useState<MeetingParticipant[]>([])
  const [copiedLink, setCopiedLink] = useState(false)
  const [ending, setEnding] = useState(false)
  const [busyControl, setBusyControl] = useState(false)

  // Real-time Chat State (hydrated from Edge Function + synced via LiveKit DataChannel & Supabase)
  const [messages, setMessages] = useState<FloatingChatMessage[]>([])
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const activePanelRef = useRef<ActiveRightPanel>(null)
  activePanelRef.current = activePanel
  const seenMessageIdsRef = useRef<Set<string>>(new Set())

  // Smart auto-hide floating controls state
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isToolbarHovered, setIsToolbarHovered] = useState(false)
  const hideTimerRef = useRef<number | null>(null)

  const effectiveIdentity = myIdentity || localParticipant.identity
  const localDisplayName = localParticipant.name || localParticipant.identity || 'You'

  const screenSharingIdentities = useMemo(
    () => new Set(screenTracks.map((t) => t.participant.identity)),
    [screenTracks]
  )

  const appendUniqueMessage = useCallback(
    (incoming: FloatingChatMessage, countUnread: boolean) => {
      if (!incoming?.id || seenMessageIdsRef.current.has(incoming.id)) return
      seenMessageIdsRef.current.add(incoming.id)
      setMessages((prev) => [...prev, incoming])
      if (
        countUnread &&
        activePanelRef.current !== 'chat' &&
        incoming.participant_identity !== effectiveIdentity
      ) {
        setUnreadChatCount((c) => c + 1)
      }
    },
    [effectiveIdentity]
  )

  // Load initial chat messages via Edge Function (supports guests & authenticated users)
  useEffect(() => {
    let cancelled = false
    invokeEdgeFunction<{ messages?: FloatingChatMessage[] }>(
      'get-livekit-token',
      {
        action: 'workspace_state',
        meeting_id: meetingId,
        invite_token: inviteToken,
        share_token: shareToken,
      },
      false
    )
      .then((res) => {
        if (!cancelled && Array.isArray(res.messages)) {
          res.messages.forEach((m) => seenMessageIdsRef.current.add(m.id))
          setMessages(res.messages)
        }
      })
      .catch(() => {})

    // Supabase Realtime subscription for authenticated participants
    const ch = supabase
      .channel(`lk-chat-${meetingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'meeting_messages', filter: `meeting_id=eq.${meetingId}` },
        (payload) => {
          appendUniqueMessage(payload.new as FloatingChatMessage, true)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(ch)
    }
  }, [meetingId, inviteToken, shareToken, appendUniqueMessage])

  // LiveKit DataChannel listener so guests & hosts receive chat messages instantaneously
  useEffect(() => {
    const handleDataReceived = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== 'varta-chat') return
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload)) as FloatingChatMessage
        if (parsed?.id && parsed?.message_text) {
          appendUniqueMessage(parsed, true)
        }
      } catch {
        // ignore malformed packets
      }
    }
    room.on(RoomEvent.DataReceived, handleDataReceived)
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived)
    }
  }, [room, appendUniqueMessage])

  const handleSendChatMessage = useCallback(
    async (text: string) => {
      try {
        const res = await invokeEdgeFunction<{ message?: FloatingChatMessage }>(
          'get-livekit-token',
          {
            action: 'send_chat',
            meeting_id: meetingId,
            invite_token: inviteToken,
            share_token: shareToken,
            message_text: text,
            participant_identity: effectiveIdentity,
            sender_name: localDisplayName,
          },
          false
        )
        if (res.message) {
          appendUniqueMessage(res.message, false)
          // Broadcast immediately over LiveKit data channel so guests see it without RLS delay
          try {
            const encoded = new TextEncoder().encode(JSON.stringify(res.message))
            await room.localParticipant.publishData(encoded, { reliable: true, topic: 'varta-chat' })
          } catch {
            // persisted in Supabase already
          }
        }
      } catch (err) {
        toast({
          type: 'error',
          title: 'Could not send message',
          description: err instanceof Error ? err.message : 'Please try again.',
        })
        throw err
      }
    },
    [meetingId, inviteToken, shareToken, effectiveIdentity, localDisplayName, appendUniqueMessage, room, toast]
  )

  // Clear unread count when Chat panel opens
  useEffect(() => {
    if (activePanel === 'chat') {
      setUnreadChatCount(0)
    }
  }, [activePanel])

  // Smart Floating Controls Auto-Hide after 4s of inactivity
  const keepPinned =
    isToolbarHovered ||
    activePanel !== null ||
    activePopover !== null ||
    (isOrganizer && waitingQueue.length > 0)

  const wakeControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    if (!keepPinned) {
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false)
      }, 4200)
    }
  }, [keepPinned])

  useEffect(() => {
    wakeControls()
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'touchstart', 'keydown']
    events.forEach((ev) => window.addEventListener(ev, wakeControls, { passive: true }))
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, wakeControls))
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
      }
    }
  }, [wakeControls])

  // Auto-switch to Screen Share view when someone begins sharing
  useEffect(() => {
    const prevCount = prevScreenCountRef.current
    const currCount = screenTracks.length
    prevScreenCountRef.current = currCount

    if (prevCount === 0 && currCount > 0) {
      setViewMode('screen_share')
      setFocusedTarget({ kind: 'screen', participantIdentity: screenTracks[0].participant.identity })
      return
    }
    if (prevCount > 0 && currCount === 0) {
      setFocusedTarget((prev) => (prev?.kind === 'participant' ? prev : null))
      setViewMode((prev) => (prev === 'screen_share' ? 'gallery' : prev))
      return
    }
    if (
      currCount > 0 &&
      viewMode === 'screen_share' &&
      focusedTarget?.kind === 'screen' &&
      !screenTracks.some((t) => t.participant.identity === focusedTarget.participantIdentity)
    ) {
      setFocusedTarget({ kind: 'screen', participantIdentity: screenTracks[0].participant.identity })
    }
  }, [screenTracks, viewMode, focusedTarget])

  // Graceful fallback if focused participant disconnects
  useEffect(() => {
    if (focusedTarget?.kind !== 'participant') return
    const stillPresent = cameraTracks.some((t) => t.participant.identity === focusedTarget.participantIdentity)
    if (!stillPresent) {
      if (screenTracks.length > 0) {
        setViewMode('screen_share')
        setFocusedTarget({ kind: 'screen', participantIdentity: screenTracks[0].participant.identity })
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
        loadDbParticipants
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [isOrganizer, meetingId])

  const handleSelectParticipant = (identity: string) => {
    setFocusedTarget({ kind: 'participant', participantIdentity: identity })
    setViewMode('focus')
  }

  const handleSelectScreenShare = (identity?: string) => {
    const target = identity
      ? screenTracks.find((t) => t.participant.identity === identity) ?? screenTracks[0]
      : screenTracks[0]
    if (!target) return
    setFocusedTarget({ kind: 'screen', participantIdentity: target.participant.identity })
    setViewMode('screen_share')
  }

  const handleSwitchViewMode = (nextMode: MeetingViewMode) => {
    if (nextMode === 'gallery') {
      setViewMode('gallery')
      return
    }
    if (nextMode === 'screen_share') {
      if (screenTracks.length > 0) {
        handleSelectScreenShare(focusedTarget?.kind === 'screen' ? focusedTarget.participantIdentity : undefined)
      }
      return
    }
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
      setFocusedTarget({ kind: 'participant', participantIdentity: activeSpeakerTrack.participant.identity })
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

  const togglePanel = (panel: Exclude<ActiveRightPanel, null>) => {
    setActivePopover(null)
    setActivePanel((prev) => (prev === panel ? null : panel))
  }

  const togglePopover = (popover: Exclude<ActivePopover, null>) => {
    setActivePopover((prev) => (prev === popover ? null : popover))
  }

  // Resolve primary stage items & compact floating thumbnail strip items
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

  const stripScreenTracks = mainScreenTrack
    ? screenTracks.filter((t) => t.participant.identity !== mainScreenTrack.participant.identity)
    : viewMode === 'focus'
      ? screenTracks
      : []

  const stripCameraTracks = mainParticipantTrack
    ? cameraTracks.filter((t) => t.participant.identity !== mainParticipantTrack.participant.identity)
    : mainScreenTrack
      ? cameraTracks
      : []

  const hasFloatingStrip =
    (viewMode === 'focus' || viewMode === 'screen_share') &&
    (stripScreenTracks.length > 0 || stripCameraTracks.length > 0)

  const hasActiveScreenShare = screenTracks.length > 0
  const isSingleParticipantGallery = viewMode === 'gallery' && cameraTracks.length <= 1
  const firstWaiting = waitingQueue[0]

  return (
    <div
      onClick={() => {
        if (!controlsVisible) setControlsVisible(true)
        if (activePopover) setActivePopover(null)
      }}
      className="h-[100dvh] w-[100vw] overflow-hidden bg-[#040508] p-1 sm:p-1.5 select-none"
    >
      <RoomAudioRenderer />

      {/* Maximum-viewport rounded stage container */}
      <div className="relative w-full h-full rounded-[20px] sm:rounded-[26px] overflow-hidden bg-[#050609] border border-[#3C40D4]/55 shadow-[0_0_36px_rgba(77,76,239,0.16)]">
        {/* ── FULL-BLEED VIDEO CANVAS ── */}
        {viewMode === 'gallery' ? (
          isSingleParticipantGallery && cameraTracks[0] ? (
            <MeetingParticipantTile
              key={`solo-${cameraTracks[0].participant.identity}`}
              trackRef={cameraTracks[0]}
              variant="main"
              isFullStage
              mirrorLocal={mirrorLocal}
              avoidBottomToolbar={controlsVisible}
              isSharingScreen={screenSharingIdentities.has(cameraTracks[0].participant.identity)}
              onJumpToScreenShare={
                screenSharingIdentities.has(cameraTracks[0].participant.identity)
                  ? () => handleSelectScreenShare(cameraTracks[0].participant.identity)
                  : undefined
              }
            />
          ) : (
            <div className="w-full h-full overflow-y-auto p-2.5 sm:p-3.5 pb-20 sm:pb-22">
              <div className={cn('grid gap-2.5 sm:gap-3 w-full', getGalleryGridClass(cameraTracks.length))}>
                {cameraTracks.map((trackRef) => (
                  <MeetingParticipantTile
                    key={`gallery-${trackRef.participant.identity}`}
                    trackRef={trackRef}
                    variant="gallery"
                    mirrorLocal={mirrorLocal}
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
          )
        ) : mainScreenTrack ? (
          <MeetingScreenShareTile
            key={`main-screen-${mainScreenTrack.participant.identity}`}
            trackRef={mainScreenTrack}
            variant="main"
            avoidBottomToolbar={controlsVisible}
            isSelected
          />
        ) : mainParticipantTrack ? (
          <MeetingParticipantTile
            key={`main-cam-${mainParticipantTrack.participant.identity}`}
            trackRef={mainParticipantTrack}
            variant="main"
            isFullStage
            mirrorLocal={mirrorLocal}
            avoidBottomToolbar={controlsVisible}
            isSelected
            isSharingScreen={screenSharingIdentities.has(mainParticipantTrack.participant.identity)}
            onJumpToScreenShare={
              screenSharingIdentities.has(mainParticipantTrack.participant.identity)
                ? () => handleSelectScreenShare(mainParticipantTrack.participant.identity)
                : undefined
            }
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/40">
            <Video className="h-12 w-12" />
            <p className="text-sm">Waiting for video stream...</p>
          </div>
        )}

        {/* ── COMPACT FLOATING THUMBNAIL STRIP (Focus / Screen Share with 2+ feeds) ── */}
        {hasFloatingStrip && (
          <div
            aria-label="Participant thumbnails"
            className={cn(
              'absolute top-3 sm:top-4 z-20 flex flex-row sm:flex-col gap-2 max-w-[calc(100%-1.5rem)] sm:max-h-[calc(100%-7rem)] overflow-x-auto sm:overflow-x-hidden sm:overflow-y-auto p-1 transition-all duration-200',
              activePanel !== null ? 'right-3 hidden md:flex md:right-[384px]' : 'right-3 sm:right-4'
            )}
          >
            {stripScreenTracks.map((screenTrack) => (
              <MeetingScreenShareTile
                key={`strip-scr-${screenTrack.participant.identity}`}
                trackRef={screenTrack}
                variant="sidebar"
                onSelect={() => handleSelectScreenShare(screenTrack.participant.identity)}
              />
            ))}
            {stripCameraTracks.map((trackRef) => (
              <MeetingParticipantTile
                key={`strip-cam-${trackRef.participant.identity}`}
                trackRef={trackRef}
                variant="sidebar"
                mirrorLocal={mirrorLocal}
                isSharingScreen={screenSharingIdentities.has(trackRef.participant.identity)}
                onSelect={() => handleSelectParticipant(trackRef.participant.identity)}
                isSelected={
                  focusedTarget?.kind === 'participant' &&
                  focusedTarget.participantIdentity === trackRef.participant.identity
                }
              />
            ))}
          </div>
        )}

        {/* ── PERSISTENT IMPORTANT ALERTS (Never auto-hidden) ── */}
        <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 pointer-events-none max-w-[92vw]">
          <StartAudio
            label="Click to Enable Room Audio"
            className="pointer-events-auto px-4 py-2 rounded-full bg-amber-400 hover:bg-amber-300 text-black text-xs font-bold shadow-xl cursor-pointer"
          />

          {isOrganizer && firstWaiting && (
            <div className="pointer-events-auto flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-[#10131F]/90 backdrop-blur-xl border border-amber-400/40 shadow-[0_14px_34px_rgba(0,0,0,0.75)]">
              <Avatar name={firstWaiting.full_name} size="xs" shape="circle" />
              <span className="text-xs font-semibold text-white max-w-[160px] sm:max-w-[220px] truncate">
                {firstWaiting.full_name} wants to join
              </span>
              {waitingQueue.length > 1 && (
                <button
                  type="button"
                  onClick={() => setActivePanel('add')}
                  className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 text-[10px] font-bold cursor-pointer"
                >
                  +{waitingQueue.length - 1} more
                </button>
              )}
              <button
                type="button"
                onClick={() => handleRemoveParticipant(firstWaiting.id)}
                title="Reject"
                className="h-7 w-7 rounded-full bg-rose-500/25 hover:bg-rose-600 text-rose-200 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleAdmit(firstWaiting.id)}
                title="Accept"
                className="h-7 px-3 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                Accept
              </button>
            </div>
          )}
        </div>

        {/* ── FLOATING RIGHT-SIDE PANELS ── */}
        {activePanel === 'chat' && (
          <FloatingChatPanel
            messages={messages}
            myIdentity={effectiveIdentity}
            onSendMessage={handleSendChatMessage}
            onClose={() => setActivePanel(null)}
          />
        )}

        {activePanel === 'participants' && (
          <FloatingParticipantsPanel
            participants={participants}
            dbParticipants={dbParticipants}
            screenSharingIdentities={screenSharingIdentities}
            isOrganizer={isOrganizer}
            focusedIdentity={
              viewMode === 'focus' && focusedTarget?.kind === 'participant'
                ? focusedTarget.participantIdentity
                : null
            }
            onSelectParticipant={(identity) => {
              handleSelectParticipant(identity)
              setActivePanel(null)
            }}
            onRemoveParticipant={handleRemoveParticipant}
            onOpenAddPanel={() => setActivePanel('add')}
            onClose={() => setActivePanel(null)}
          />
        )}

        {activePanel === 'add' && (
          <FloatingAddParticipantsPanel
            meetingId={meetingId}
            meetingCode={meetingCode}
            meetingTitle={meetingTitle}
            shareUrl={shareUrl}
            copiedLink={copiedLink}
            isOrganizer={isOrganizer}
            waitingQueue={waitingQueue}
            onCopyInvite={handleCopyInvite}
            onAdmit={handleAdmit}
            onReject={handleRemoveParticipant}
            onClose={() => setActivePanel(null)}
          />
        )}

        {/* ── FLOATING BOTTOM-CENTER BUBBLE CONTROLS ── */}
        <div
          onMouseEnter={() => setIsToolbarHovered(true)}
          onMouseLeave={() => setIsToolbarHovered(false)}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute bottom-4 sm:bottom-5 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2.5 max-w-[96vw] transition-all duration-300',
            controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          )}
        >
          {/* Floating Compact Popovers anchored cleanly above the toolbar */}
          {activePopover === 'layout' && (
            <LayoutPopover
              viewMode={viewMode}
              hasActiveScreenShare={hasActiveScreenShare}
              onSelectMode={handleSwitchViewMode}
              onClose={() => setActivePopover(null)}
            />
          )}

          {activePopover === 'more' && (
            <MoreSettingsPopover
              meetingTitle={meetingTitle}
              meetingCode={meetingCode}
              organizerName={organizerName}
              copiedLink={copiedLink}
              mirrorLocal={mirrorLocal}
              onToggleMirror={() => setMirrorLocal((v) => !v)}
              onCopyInvite={handleCopyInvite}
              onClose={() => setActivePopover(null)}
            />
          )}

          {/* Glassmorphism Pill Toolbar */}
          <nav
            aria-label="Meeting controls"
            className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2 rounded-full bg-[#10121C]/78 backdrop-blur-2xl border border-white/12 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.85)]"
          >
            <BubbleControlButton
              label={isMicrophoneEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
              onClick={handleToggleMic}
              danger={!isMicrophoneEnabled}
            >
              {isMicrophoneEnabled ? <Mic className="h-4.5 w-4.5" /> : <MicOff className="h-4.5 w-4.5" />}
            </BubbleControlButton>

            <BubbleControlButton
              label={isCameraEnabled ? 'Turn Camera Off' : 'Turn Camera On'}
              onClick={handleToggleCam}
              danger={!isCameraEnabled}
            >
              {isCameraEnabled ? <Video className="h-4.5 w-4.5" /> : <VideoOff className="h-4.5 w-4.5" />}
            </BubbleControlButton>

            <BubbleControlButton
              label={isScreenShareEnabled ? 'Stop Screen Share' : 'Share Screen'}
              onClick={handleToggleScreenShare}
              highlight={isScreenShareEnabled}
            >
              {isScreenShareEnabled ? <MonitorOff className="h-4.5 w-4.5" /> : <MonitorUp className="h-4.5 w-4.5" />}
            </BubbleControlButton>

            <BubbleControlButton
              label="Add Participants & Invites"
              onClick={() => togglePanel('add')}
              active={activePanel === 'add'}
              pulseDot={isOrganizer && waitingQueue.length > 0}
            >
              <UserPlus className="h-4.5 w-4.5" />
            </BubbleControlButton>

            <BubbleControlButton
              label="Participants"
              onClick={() => togglePanel('participants')}
              active={activePanel === 'participants'}
              badge={participants.length}
            >
              <Users className="h-4.5 w-4.5" />
            </BubbleControlButton>

            <BubbleControlButton
              label="Room Chat"
              onClick={() => togglePanel('chat')}
              active={activePanel === 'chat'}
              badge={unreadChatCount}
            >
              <MessageSquare className="h-4.5 w-4.5" />
            </BubbleControlButton>

            <BubbleControlButton
              label="Switch Layout"
              onClick={() => togglePopover('layout')}
              active={activePopover === 'layout'}
            >
              <LayoutGrid className="h-4.5 w-4.5" />
            </BubbleControlButton>

            <BubbleControlButton
              label="More Settings & Meeting Info"
              onClick={() => togglePopover('more')}
              active={activePopover === 'more'}
            >
              <MoreHorizontal className="h-4.5 w-4.5" />
            </BubbleControlButton>

            <div className="hidden sm:block w-px h-7 bg-white/15 mx-0.5" />

            {/* Leave Meeting (Red Pill) */}
            <div className="relative group/btn">
              <button
                type="button"
                onClick={handleLeaveClick}
                aria-label="Leave Meeting"
                title="Leave Meeting"
                className="h-10 sm:h-11 px-3.5 sm:px-4 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-[0_8px_24px_rgba(225,29,72,0.45)] transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer"
              >
                <PhoneOff className="h-4 w-4 shrink-0" />
                <span className="hidden md:inline">Leave Meeting</span>
              </button>
              <span
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 hidden sm:block md:hidden absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 rounded-lg bg-[#0D101B]/95 border border-white/12 text-[11px] font-medium text-white shadow-lg"
              >
                Leave Meeting
              </span>
            </div>

            {/* Host-Only End Meeting (Red) */}
            {isOrganizer && (
              <div className="relative group/btn">
                <button
                  type="button"
                  onClick={handleEndClick}
                  disabled={ending}
                  aria-label="End Meeting for Everyone"
                  title="End Meeting for Everyone"
                  className="h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-red-700 hover:bg-red-600 border border-rose-300/35 text-white flex items-center justify-center shadow-[0_8px_24px_rgba(185,28,28,0.45)] transition-all duration-150 hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <Power className="h-4 w-4" />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 hidden sm:block absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 rounded-lg bg-[#0D101B]/95 border border-white/12 text-[11px] font-medium text-white shadow-lg"
                >
                  {ending ? 'Ending...' : 'End Meeting'}
                </span>
              </div>
            )}
          </nav>
        </div>
      </div>
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
  organizerName,
  inviteToken = '',
  shareToken = '',
  participantIdentity = '',
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
        toast({ type: 'error', title: 'LiveKit Connection Issue', description: err.message })
      }}
    >
      <LiveKitStageInner
        meetingId={meetingId}
        meetingCode={meetingCode}
        meetingTitle={meetingTitle}
        organizerName={organizerName}
        shareUrl={shareUrl}
        inviteToken={inviteToken}
        shareToken={shareToken}
        isOrganizer={isOrganizer}
        leavingBySelfRef={leavingBySelfRef}
        onLeave={onLeave}
        onEndMeeting={onEndMeeting}
        myIdentity={participantIdentity}
      />
    </LiveKitRoom>
  )
}
