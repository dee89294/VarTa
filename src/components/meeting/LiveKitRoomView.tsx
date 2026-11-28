/**
 * File: src/components/meeting/LiveKitRoomView.tsx
 * Purpose: Premium light-theme real-time video meeting room powered by LiveKit Cloud SDK.
 *   Layout: Header | Main Video (left) + Participant Strip (bottom-left) | Right Sidebar (chat/participants)
 *   View modes: Focus (one main + strip), Gallery (grid), Screen Share (screen main + strip)
 *
 * Connected files:
 *   - `src/pages/MeetingRoomPage.tsx` (supplies LiveKit JWT, serverUrl, and lifecycle callbacks)
 *   - `src/components/meeting/MeetingStageTiles.tsx` (video, screen-share, speaker, and role tiles)
 *   - `supabase/functions/get-livekit-token/index.ts` (admit/remove/leave/end endpoints)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
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
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Power,
  Send,
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

/** Three supported viewing modes */
export type MeetingViewMode = 'gallery' | 'focus' | 'screen_share'

/** Tracks which stream occupies the primary viewing area */
type FocusedTarget =
  | { kind: 'screen'; participantIdentity: string }
  | { kind: 'participant'; participantIdentity: string }

interface MeetingMessage {
  id: string
  sender_name: string
  sender_role: string
  message_text: string
  created_at: string
  participant_identity?: string
}

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
  // Extended props from MeetingRoomPage
  organizerName?: string
  inviteToken?: string
  shareToken?: string
  participantIdentity?: string
  canEditWorkspace?: boolean
  initialSummary?: { description: string; agenda: string; discussion_points: string }
  initialRecordingStatus?: 'idle' | 'recording' | 'paused'
}

function getGalleryGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 max-w-4xl mx-auto my-auto [&>*]:h-auto [&>*]:aspect-video'
  if (count === 2) return 'grid-cols-2 h-full auto-rows-fr'
  if (count <= 4) return 'grid-cols-2 h-full auto-rows-fr'
  if (count <= 6) return 'grid-cols-3 h-full auto-rows-fr'
  if (count <= 9) return 'grid-cols-3 h-full auto-rows-fr'
  return 'grid-cols-4 auto-rows-[minmax(160px,1fr)]'
}

/** Formats HH:MM from ISO timestamp */
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Chat panel — real-time messages from Supabase meeting_messages table */
function ChatPanel({
  meetingId,
  myIdentity,
  myName,
}: {
  meetingId: string
  myIdentity: string
  myName: string
}) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<MeetingMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load initial messages and subscribe to realtime
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('meeting_messages')
        .select('id, sender_name, sender_role, message_text, created_at, participant_identity')
        .eq('meeting_id', meetingId)
        .order('created_at', { ascending: true })
        .limit(200)
      if (data) setMessages(data as MeetingMessage[])
    }
    load()

    const ch = supabase
      .channel(`chat-${meetingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'meeting_messages', filter: `meeting_id=eq.${meetingId}` },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev
            return [...prev, payload.new as MeetingMessage]
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [meetingId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setInput('')
    try {
      await invokeEdgeFunction('get-livekit-token', {
        action: 'send_chat',
        meeting_id: meetingId,
        message_text: text,
        participant_identity: myIdentity,
        sender_name: myName,
      })
    } catch {
      toast({ type: 'error', title: 'Could not send message' })
      setInput(text)
    } finally {
      setSending(false)
    }
  }, [input, sending, meetingId, myIdentity, myName, toast])

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-xs text-[#8D92A8] mt-8">No messages yet. Say hello! 👋</div>
        )}
        {messages.map((msg) => {
          const isMe = msg.participant_identity === myIdentity
          return (
            <div key={msg.id} className={cn('flex gap-2', isMe && 'flex-row-reverse')}>
              <Avatar name={msg.sender_name} size="xs" shape="circle" className="shrink-0 mt-0.5" />
              <div className={cn('max-w-[78%]', isMe && 'items-end flex flex-col')}>
                <div className={cn('flex items-baseline gap-1.5 mb-0.5', isMe && 'flex-row-reverse')}>
                  <span className="text-[11px] font-semibold text-[#454A62]">
                    {isMe ? 'You' : msg.sender_name}
                  </span>
                  <span className="text-[10px] text-[#8D92A8]">{fmtTime(msg.created_at)}</span>
                </div>
                <div
                  className={cn(
                    'px-3 py-2 rounded-2xl text-xs leading-relaxed',
                    isMe
                      ? 'bg-[#4D4CEF] text-white rounded-tr-sm'
                      : 'bg-[#F0F1F8] text-[#151722] rounded-tl-sm'
                  )}
                >
                  {msg.message_text}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[#E9ECF6] flex gap-2 items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Type message here..."
          className="flex-1 px-3.5 py-2 rounded-full bg-[#F5F6FB] border border-[#E5E8F2] text-xs text-[#151722] placeholder:text-[#8D92A8] focus:outline-none focus:border-[#4D4CEF]"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="h-8 w-8 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] disabled:opacity-40 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
        >
          <Send className="h-3.5 w-3.5 text-white" />
        </button>
      </div>
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
  shareUrl,
  isOrganizer,
  leavingBySelfRef,
  onLeave,
  onEndMeeting,
  myIdentity,
  myName,
}: {
  meetingId: string
  meetingCode: string
  meetingTitle: string
  shareUrl?: string | null
  isOrganizer: boolean
  leavingBySelfRef: MutableRefObject<boolean>
  onLeave: () => void
  onEndMeeting: () => Promise<void>
  myIdentity: string
  myName: string
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

  const [sidebarTab, setSidebarTab] = useState<'chat' | 'participants'>('chat')
  const [waitingQueue, setWaitingQueue] = useState<MeetingParticipant[]>([])
  const [dbParticipants, setDbParticipants] = useState<MeetingParticipant[]>([])
  const [copiedLink, setCopiedLink] = useState(false)
  const [ending, setEnding] = useState(false)
  const [busyControl, setBusyControl] = useState(false)

  const screenSharingIdentities = useMemo(
    () => new Set(screenTracks.map((t) => t.participant.identity)),
    [screenTracks]
  )

  // Auto-switch to Screen Share view
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

  // Fallback if focused participant disconnects
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

  // Organizer waiting room monitoring
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_participants', filter: `meeting_id=eq.${meetingId}` }, loadDbParticipants)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
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
    if (nextMode === 'gallery') { setViewMode('gallery'); return }
    if (nextMode === 'screen_share') {
      if (screenTracks.length > 0) handleSelectScreenShare(focusedTarget?.kind === 'screen' ? focusedTarget.participantIdentity : undefined)
      return
    }
    if (focusedTarget?.kind === 'participant' && cameraTracks.some((t) => t.participant.identity === focusedTarget.participantIdentity)) {
      setViewMode('focus'); return
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
    try { await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled) }
    catch (err) { toast({ type: 'error', title: 'Microphone Error', description: err instanceof Error ? err.message : 'Check browser permission.' }) }
    finally { setBusyControl(false) }
  }

  const handleToggleCam = async () => {
    if (busyControl) return
    setBusyControl(true)
    try { await localParticipant.setCameraEnabled(!isCameraEnabled) }
    catch (err) { toast({ type: 'error', title: 'Camera Error', description: err instanceof Error ? err.message : 'Check browser permission.' }) }
    finally { setBusyControl(false) }
  }

  const handleToggleScreenShare = async () => {
    try { await localParticipant.setScreenShareEnabled(!isScreenShareEnabled) }
    catch (err) { toast({ type: 'warning', title: 'Screen Share Cancelled', description: err instanceof Error ? err.message : 'Permission denied.' }) }
  }

  const handleCopyInvite = async () => {
    let urlToCopy = shareUrl || `${window.location.origin}/meeting/${meetingCode}`
    if (!shareUrl && isOrganizer) {
      try {
        const res = await invokeEdgeFunction<{ share_url: string }>('meeting-invitations', { action: 'get_share_link', meeting_id: meetingId })
        urlToCopy = res.share_url
      } catch { /* fallback */ }
    }
    try {
      await navigator.clipboard.writeText(urlToCopy)
      setCopiedLink(true)
      toast({ type: 'success', title: 'Meeting Link Copied' })
      setTimeout(() => setCopiedLink(false), 2000)
    } catch { toast({ type: 'error', title: 'Clipboard blocked' }) }
  }

  const handleAdmit = async (participantId: string) => {
    try {
      await invokeEdgeFunction('get-livekit-token', { action: 'admit_participant', meeting_id: meetingId, target_participant_id: participantId })
      toast({ type: 'success', title: 'Participant Admitted' })
    } catch (err) { toast({ type: 'error', title: 'Could not admit', description: err instanceof Error ? err.message : 'Error' }) }
  }

  const handleDismiss = async (participantId: string) => {
    try {
      await invokeEdgeFunction('get-livekit-token', { action: 'remove_participant', meeting_id: meetingId, target_participant_id: participantId })
      toast({ type: 'info', title: 'Participant Dismissed' })
    } catch (err) { toast({ type: 'error', title: 'Could not dismiss', description: err instanceof Error ? err.message : 'Error' }) }
  }

  const handleRemoveParticipant = async (participantId: string) => {
    try {
      await invokeEdgeFunction('get-livekit-token', { action: 'remove_participant', meeting_id: meetingId, target_participant_id: participantId })
      toast({ type: 'info', title: 'Participant Removed' })
    } catch (err) { toast({ type: 'error', title: 'Could not remove', description: err instanceof Error ? err.message : 'Error' }) }
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
    try { await onEndMeeting() } finally { setEnding(false) }
  }

  // Resolve main/sidebar items
  const mainScreenTrack =
    viewMode === 'screen_share' && screenTracks.length > 0
      ? screenTracks.find((t) => focusedTarget?.kind === 'screen' && t.participant.identity === focusedTarget.participantIdentity) ?? screenTracks[0]
      : null

  const mainParticipantTrack =
    viewMode === 'focus'
      ? cameraTracks.find((t) => focusedTarget?.kind === 'participant' && t.participant.identity === focusedTarget.participantIdentity) ?? cameraTracks[0] ?? null
      : null

  // Strip thumbnails: all participants except the main one
  const stripTracks = mainParticipantTrack
    ? cameraTracks.filter((t) => t.participant.identity !== mainParticipantTrack.participant.identity)
    : mainScreenTrack
      ? cameraTracks // Show all cameras when screen sharing
      : []

  const stripScreenTracks = mainScreenTrack
    ? screenTracks.filter((t) => t.participant.identity !== mainScreenTrack.participant.identity)
    : []

  const hasActiveScreenShare = screenTracks.length > 0
  const firstWaiting = waitingQueue[0]

  // Determine display name from local participant
  const localDisplayName = localParticipant.name || localParticipant.identity || myName || 'You'

  return (
    <div className="h-[100dvh] w-full bg-[#F3F4F9] flex flex-col overflow-hidden">
      <RoomAudioRenderer />

      {/* ── TOP HEADER ── */}
      <header className="px-4 py-2.5 bg-white border-b border-[#E9ECF6] flex items-center justify-between gap-3 shrink-0 shadow-sm">
        {/* Left: Brand + Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#4D4CEF] to-[#9C65E5] flex items-center justify-center font-bold text-white text-sm shrink-0">
            V
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-sm text-[#151722] truncate">{meetingTitle}</h1>
            <p className="text-[11px] font-mono text-[#6E748C] truncate">{meetingCode}</p>
          </div>
        </div>

        {/* Center: Waiting Room Notification */}
        {isOrganizer && firstWaiting && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 shrink-0">
            <Avatar name={firstWaiting.full_name} size="xs" shape="circle" />
            <span className="text-xs font-semibold text-amber-800 max-w-[120px] truncate">
              {firstWaiting.full_name} wants to join
            </span>
            {waitingQueue.length > 1 && (
              <span className="text-[10px] text-amber-600">+{waitingQueue.length - 1}</span>
            )}
            <button
              type="button"
              onClick={() => handleDismiss(firstWaiting.id)}
              className="h-6 w-6 rounded-full bg-red-100 hover:bg-red-200 flex items-center justify-center cursor-pointer"
              title="Reject"
            >
              <X className="h-3 w-3 text-red-600" />
            </button>
            <button
              type="button"
              onClick={() => handleAdmit(firstWaiting.id)}
              className="h-6 w-6 rounded-full bg-emerald-100 hover:bg-emerald-200 flex items-center justify-center cursor-pointer"
              title="Admit"
            >
              <Check className="h-3 w-3 text-emerald-700" />
            </button>
          </div>
        )}

        {/* Right: Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <StartAudio label="Enable Audio" className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold" />

          {/* View Switcher */}
          <div className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-full bg-[#F0F1F8] border border-[#E5E8F2]">
            <button
              type="button"
              onClick={() => handleSwitchViewMode('focus')}
              className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer',
                viewMode === 'focus' ? 'bg-white text-[#4D4CEF] shadow-sm' : 'text-[#6E748C] hover:text-[#151722]')}
            >
              <Maximize2 className="h-3 w-3" />Focus
            </button>
            <button
              type="button"
              onClick={() => handleSwitchViewMode('gallery')}
              className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer',
                viewMode === 'gallery' ? 'bg-white text-[#4D4CEF] shadow-sm' : 'text-[#6E748C] hover:text-[#151722]')}
            >
              <LayoutGrid className="h-3 w-3" />Gallery
            </button>
            <button
              type="button"
              onClick={() => handleSwitchViewMode('screen_share')}
              disabled={!hasActiveScreenShare}
              className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all',
                !hasActiveScreenShare ? 'opacity-40 cursor-not-allowed text-[#6E748C]' : 'cursor-pointer',
                viewMode === 'screen_share' ? 'bg-white text-[#4D4CEF] shadow-sm' : hasActiveScreenShare ? 'text-[#6E748C] hover:text-[#151722]' : '')}
            >
              <MonitorUp className="h-3 w-3" />Share
              {hasActiveScreenShare && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyInvite}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F0F1F8] hover:bg-[#E5E8F2] text-[11px] font-semibold text-[#454A62] cursor-pointer"
          >
            {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedLink ? 'Copied' : 'Copy Link'}
          </button>

          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#F0F1F8] border border-[#E5E8F2]">
            <Users className="h-3.5 w-3.5 text-[#6E748C]" />
            <span className="text-xs font-semibold text-[#454A62]">{participants.length}</span>
          </div>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="flex-1 min-h-0 flex gap-3 p-3 overflow-hidden">

        {/* ── LEFT SECTION: Main Video + Participant Strip ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">

          {/* Main Video Area */}
          <div className="flex-1 relative rounded-3xl overflow-hidden bg-[#1A1D2E] shadow-xl min-h-0">
            {viewMode === 'gallery' ? (
              /* Gallery: full grid inside the main container */
              <div className="w-full h-full overflow-y-auto p-3">
                <div className={cn('grid gap-3 w-full h-full', getGalleryGridClass(cameraTracks.length))}>
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
              /* Focus / Screen Share: main stream */
              <div className="w-full h-full flex items-center justify-center">
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
                ) : (
                  <div className="flex flex-col items-center gap-3 text-white/40">
                    <Video className="h-12 w-12" />
                    <p className="text-sm">No video available</p>
                  </div>
                )}
              </div>
            )}

            {/* Floating Controls over main video */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
              <button
                type="button"
                onClick={handleToggleMic}
                title={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
                className={cn(
                  'h-11 w-11 rounded-full flex items-center justify-center shadow-lg transition-all cursor-pointer',
                  isMicrophoneEnabled ? 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-md' : 'bg-rose-500 hover:bg-rose-600 text-white'
                )}
              >
                {isMicrophoneEnabled ? <Mic className="h-4.5 w-4.5" /> : <MicOff className="h-4.5 w-4.5" />}
              </button>

              <button
                type="button"
                onClick={handleToggleCam}
                title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                className={cn(
                  'h-11 w-11 rounded-full flex items-center justify-center shadow-lg transition-all cursor-pointer',
                  isCameraEnabled ? 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-md' : 'bg-rose-500 hover:bg-rose-600 text-white'
                )}
              >
                {isCameraEnabled ? <Video className="h-4.5 w-4.5" /> : <VideoOff className="h-4.5 w-4.5" />}
              </button>

              <button
                type="button"
                onClick={handleToggleScreenShare}
                title={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}
                className={cn(
                  'h-11 w-11 rounded-full flex items-center justify-center shadow-lg transition-all cursor-pointer',
                  isScreenShareEnabled ? 'bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white' : 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-md'
                )}
              >
                {isScreenShareEnabled ? <MonitorOff className="h-4.5 w-4.5" /> : <MonitorUp className="h-4.5 w-4.5" />}
              </button>

              <div className="w-px h-8 bg-white/20 mx-1" />

              <button
                type="button"
                onClick={handleLeaveClick}
                title="Leave meeting"
                className="h-11 w-11 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center shadow-lg cursor-pointer text-white"
              >
                <PhoneOff className="h-4.5 w-4.5" />
              </button>

              {isOrganizer && (
                <button
                  type="button"
                  onClick={handleEndClick}
                  disabled={ending}
                  title="End meeting for everyone"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white/20 hover:bg-rose-600 backdrop-blur-md border border-rose-400/50 text-white text-xs font-semibold shadow-lg cursor-pointer transition-all"
                >
                  <Power className="h-4 w-4" />
                  {ending ? 'Ending...' : 'End'}
                </button>
              )}
            </div>
          </div>

          {/* ── Horizontal Participant Strip (Focus / Screen Share mode) ── */}
          {(viewMode === 'focus' || viewMode === 'screen_share') && (stripTracks.length > 0 || stripScreenTracks.length > 0) && (
            <div className="h-28 shrink-0 flex gap-2.5 overflow-x-auto pb-0.5">
              {/* Other screen shares */}
              {stripScreenTracks.map((screenTrack) => (
                <div key={`strip-scr-${screenTrack.participant.identity}`} className="h-full aspect-video shrink-0">
                  <MeetingScreenShareTile
                    trackRef={screenTrack}
                    variant="sidebar"
                    onSelect={() => handleSelectScreenShare(screenTrack.participant.identity)}
                  />
                </div>
              ))}
              {/* Participant cameras */}
              {stripTracks.map((trackRef) => (
                <div key={`strip-cam-${trackRef.participant.identity}`} className="h-full aspect-video shrink-0">
                  <MeetingParticipantTile
                    trackRef={trackRef}
                    variant="sidebar"
                    isSharingScreen={screenSharingIdentities.has(trackRef.participant.identity)}
                    onSelect={() => handleSelectParticipant(trackRef.participant.identity)}
                    isSelected={
                      focusedTarget?.kind === 'participant' &&
                      focusedTarget.participantIdentity === trackRef.participant.identity
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <aside className="w-72 xl:w-80 shrink-0 flex flex-col gap-3 min-h-0 hidden lg:flex">
          {/* Chat / Participants Panel */}
          <div className="flex-1 bg-white rounded-3xl shadow-sm border border-[#E9ECF6] flex flex-col min-h-0 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-[#E9ECF6] shrink-0">
              <button
                type="button"
                onClick={() => setSidebarTab('chat')}
                className={cn(
                  'flex-1 py-3 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer',
                  sidebarTab === 'chat'
                    ? 'text-[#4D4CEF] border-b-2 border-[#4D4CEF]'
                    : 'text-[#6E748C] hover:text-[#454A62]'
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Room Chat
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('participants')}
                className={cn(
                  'flex-1 py-3 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer',
                  sidebarTab === 'participants'
                    ? 'text-[#4D4CEF] border-b-2 border-[#4D4CEF]'
                    : 'text-[#6E748C] hover:text-[#454A62]'
                )}
              >
                <Users className="h-3.5 w-3.5" />
                Participants
                <span className="px-1.5 py-0.5 rounded-full bg-[#F0F1F8] text-[10px] font-bold text-[#6E748C]">
                  {participants.length}
                </span>
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {sidebarTab === 'chat' ? (
                <ChatPanel meetingId={meetingId} myIdentity={myIdentity || localParticipant.identity} myName={localDisplayName} />
              ) : (
                /* Participants List */
                <div className="h-full overflow-y-auto">
                  {/* Invite Link */}
                  <div className="p-3 border-b border-[#F0F1F8]">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCopyInvite}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white text-xs font-semibold cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy Invite Link
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const url = shareUrl || `${window.location.origin}/meeting/${meetingCode}`
                          window.open(`https://wa.me/?text=${encodeURIComponent(`Join "${meetingTitle}" on VARTA: ${url}`)}`, '_blank', 'noopener,noreferrer')
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Waiting room (organizer) */}
                  {isOrganizer && waitingQueue.length > 0 && (
                    <div className="p-3 border-b border-[#F0F1F8] space-y-2">
                      <p className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Waiting Room ({waitingQueue.length})</p>
                      {waitingQueue.map((wp) => (
                        <div key={wp.id} className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-amber-50 border border-amber-100">
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar name={wp.full_name} size="xs" shape="circle" />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[#151722] truncate">{wp.full_name}</p>
                              <p className="text-[10px] text-[#6E748C] capitalize">{wp.participant_type}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => handleDismiss(wp.id)} className="h-6 w-6 rounded-full bg-red-100 hover:bg-red-200 flex items-center justify-center cursor-pointer">
                              <X className="h-3 w-3 text-red-600" />
                            </button>
                            <button type="button" onClick={() => handleAdmit(wp.id)} className="h-6 w-6 rounded-full bg-emerald-100 hover:bg-emerald-200 flex items-center justify-center cursor-pointer">
                              <UserCheck className="h-3 w-3 text-emerald-700" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* In-call participants */}
                  <div className="p-3 space-y-1.5">
                    <p className="text-[11px] font-bold text-[#8D92A8] uppercase tracking-wider mb-2">In This Meeting</p>
                    {participants.map((p) => {
                      const roleType = parseParticipantRole(p)
                      const dbRow = dbParticipants.find((row) => row.participant_identity === p.identity)
                      const isFocused = viewMode === 'focus' && focusedTarget?.kind === 'participant' && focusedTarget.participantIdentity === p.identity
                      return (
                        <div
                          key={p.identity}
                          onClick={() => handleSelectParticipant(p.identity)}
                          className={cn(
                            'flex items-center justify-between gap-2 p-2.5 rounded-2xl border cursor-pointer transition-colors',
                            isFocused ? 'bg-[#4D4CEF]/8 border-[#4D4CEF]/30' : 'bg-[#F8F9FD] border-transparent hover:border-[#E5E8F2]'
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar name={p.name || p.identity} size="xs" shape="circle" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-[#151722] truncate">
                                  {p.name || p.identity}{p.isLocal ? ' (You)' : ''}
                                </span>
                                <RoleTag type={roleType} />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {screenSharingIdentities.has(p.identity) && <MonitorUp className="h-3.5 w-3.5 text-[#4D4CEF]" />}
                            {p.isMicrophoneEnabled
                              ? <Mic className="h-3.5 w-3.5 text-[#4D4CEF]" />
                              : <MicOff className="h-3.5 w-3.5 text-rose-400" />}
                            {isOrganizer && !p.isLocal && dbRow && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleRemoveParticipant(dbRow.id) }}
                                title="Remove participant"
                                className="p-1 rounded-full hover:bg-rose-50 text-[#8D92A8] hover:text-rose-500 cursor-pointer"
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
              )}
            </div>
          </div>
        </aside>
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
  participantIdentity = '',
  initialSummary: _initialSummary,
  initialRecordingStatus: _initialRecordingStatus,
  inviteToken: _inviteToken,
  shareToken: _shareToken,
  organizerName: _organizerName,
  canEditWorkspace: _canEditWorkspace,
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
        shareUrl={shareUrl}
        isOrganizer={isOrganizer}
        leavingBySelfRef={leavingBySelfRef}
        onLeave={onLeave}
        onEndMeeting={onEndMeeting}
        myIdentity={participantIdentity}
        myName=""
      />
    </LiveKitRoom>
  )
}
