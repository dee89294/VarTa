/**
 * File: src/pages/LiveMeetingPage.tsx
 * Purpose: Full-Screen Distraction-Free Calling Window with Collapsed-by-Default Right Icon Sidebar,
 *   Access Gate, Waiting Room, WebRTC Media, Live Attendance Monitor, Chat, Notes, Details, Screen Share,
 *   and Local Recording in VarTa's Lavender-Alabaster (`#F3F4F9`), Crisp White, Royal Indigo (`#4D4CEF`),
 *   Orchid Violet (`#9C65E5`), and Obsidian Charcoal (`#15161C`) identity.
 * Why required: Keeps the active video meeting prominent across nearly the entire browser viewport while
 *   tucking all 7 secondary tools (Participants, Chat, Meeting Details, Notes, Screen Sharing, Recording,
 *   and Settings) into an animated click-to-open glassmorphic right sidebar collapsed to icons by default.
 * Connected files:
 *   - `src/App.tsx` (`WorkspaceWithCallHost` manages Full Screen & Floating Minimized PiP modes)
 *   - `src/hooks/useWebRTCMeeting.ts` (WebRTC streams, screen sharing, active speaker detection, mute/remove)
 *   - `src/contexts/AuthContext.tsx` (`employee`, `role`)
 *   - `src/lib/supabase.ts` (Realtime subscriptions on `meetings`, `meeting_participants`, `attendance`,
 *     `meeting_messages`, `meeting_agenda`; calls `meeting-access` Edge Function)
 *   - `supabase/functions/meeting-access/index.ts` (invite allowlist check, waiting room, `confirm_entry`,
 *     `heartbeat`, `leave`, `admit`/`reject`/`remove`, `invite_participants`, `end_meeting`)
 *   - `src/lib/export.ts` (`exportAttendanceCSV` for attendance export)
 * Impact if modified/removed: Breaks video conferencing, access enforcement, attendance tracking, and sidebar tools.
 */
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  Hand,
  Settings,
  PhoneOff,
  Users,
  MessageSquare,
  Info,
  FileText,
  Radio,
  Send,
  Copy,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Expand,
  Shrink,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Download,
  VolumeX,
  UserMinus,
  ChevronLeft,
  MoreHorizontal,
  Plus,
  X,
  Square,
  CircleDot,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { exportAttendanceCSV } from '../lib/export'
import { cn, formatClockTimer, formatDate, formatDateTime, formatTime } from '../lib/utils'
import { getDisplayEmployeeId, isFoundingMember } from '../lib/orgUtils'
import { useWebRTCMeeting } from '../hooks/useWebRTCMeeting'
import { Avatar } from '../components/ui/Avatar'
import { AttendanceStatusBadge, MeetingStatusBadge } from '../components/ui/StatusBadge'
import { Modal } from '../components/ui/Modal'
import type {
  AttendanceRecord,
  Employee,
  Meeting,
  MeetingAgendaItem,
  MeetingMessage,
  MeetingParticipant,
} from '../types/database'

interface LiveMeetingPageProps {
  meetingIdProp?: string
  windowMode?: 'fullscreen' | 'minimized'
  onMinimize?: () => void
  onMaximize?: () => void
  onCloseCall?: (dest?: string) => void
}

type SidebarTab = 'participants' | 'chat' | 'details' | 'notes' | 'screenshare' | 'recording' | 'settings'

interface SessionNote {
  id: string
  time: string
  author: string
  text: string
}

function CallingVideoTile({
  stream,
  muted = false,
  fullName,
  employeeCode,
  avatarUrl,
  micOn,
  camOn,
  handRaised,
  isActiveSpeaker,
  isPrimary = false,
  isPinned = false,
  elapsedText,
  isRecording = false,
  onPin,
  onToggleLayout,
  onQuickMute,
}: {
  stream: MediaStream | null
  muted?: boolean
  fullName: string
  employeeCode: string
  avatarUrl?: string | null
  micOn: boolean
  camOn: boolean
  handRaised?: boolean
  isActiveSpeaker?: boolean
  isPrimary?: boolean
  isPinned?: boolean
  elapsedText?: string
  isRecording?: boolean
  onPin?: () => void
  onToggleLayout?: () => void
  onQuickMute?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const hasLiveVideo = Boolean(stream && stream.getVideoTracks().some((t) => t.enabled))

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-gradient-to-br from-[#EAECF7] via-[#E1E4F4] to-[#ECE7F8] border flex items-center justify-center group transition-all duration-200',
        isPrimary ? 'rounded-[24px] w-full h-full min-h-[260px]' : 'rounded-[18px] w-full h-full min-h-[120px]',
        isActiveSpeaker
          ? 'border-[#4D4CEF] ring-2 ring-[#4D4CEF]/25 shadow-[0_14px_34px_-10px_rgba(77,76,239,0.28)]'
          : 'border-[#E3E6F2] hover:border-[#4D4CEF]/35'
      )}
    >
      {hasLiveVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 p-3">
          <Avatar
            name={fullName}
            src={avatarUrl}
            size={isPrimary ? 'xl' : 'md'}
            shape="circle"
            className="ring-4 ring-white shadow-md"
          />
          {!camOn && (
            <span className="px-2.5 py-0.5 rounded-full bg-white/85 backdrop-blur-sm border border-[#DFE3F2] text-[10px] font-semibold text-[#5E647B]">
              Camera off
            </span>
          )}
        </div>
      )}

      {/* Primary Stage Top Overlays */}
      {isPrimary && (
        <>
          <div className="absolute top-3.5 left-3.5 flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#15161C]/80 backdrop-blur-md text-[11px] font-semibold text-white border border-white/15 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-[#F03E3E] animate-pulse" />
              <span>Live</span>
              {elapsedText && <span className="font-mono text-white/90 ml-0.5">{elapsedText}</span>}
            </div>
            {isRecording && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F03E3E] text-[11px] font-bold text-white shadow-sm">
                <CircleDot className="h-3 w-3 animate-pulse" />
                <span>REC</span>
              </div>
            )}
          </div>

          {onToggleLayout && (
            <button
              onClick={onToggleLayout}
              title="Toggle Grid / Speaker view"
              className="absolute top-3.5 right-3.5 h-9 w-9 rounded-full bg-white/90 hover:bg-white backdrop-blur-md border border-[#E5E8F3] text-[#151722] flex items-center justify-center shadow-sm transition-all"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          )}
        </>
      )}

      {/* Thumbnail Pin Control */}
      {!isPrimary && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
          {handRaised && (
            <span className="h-6 w-6 rounded-full bg-amber-400 text-[#151722] flex items-center justify-center shadow-sm animate-bounce">
              <Hand className="h-3 w-3" />
            </span>
          )}
          {onPin && (
            <button
              onClick={onPin}
              title={isPinned ? 'Unpin' : 'Focus on main stage'}
              className={cn(
                'h-7 w-7 rounded-full backdrop-blur-md flex items-center justify-center transition-colors shadow-sm',
                isPinned
                  ? 'bg-[#4D4CEF] text-white'
                  : 'bg-white/90 hover:bg-white text-[#151722] border border-[#E5E8F3]'
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Bottom Name & Mic Pill */}
      {isPrimary ? (
        <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2 flex items-center gap-2 max-w-[90%]">
          {handRaised && (
            <span className="h-8 w-8 rounded-full bg-amber-400 text-[#151722] flex items-center justify-center shadow-md shrink-0 animate-bounce">
              <Hand className="h-3.5 w-3.5" />
            </span>
          )}
          <div className="px-4 py-1.5 rounded-full bg-[#15161C]/75 backdrop-blur-md border border-white/15 flex items-center gap-2 truncate shadow-sm">
            <span className="text-xs font-semibold text-white truncate">{fullName}</span>
            <span className="font-mono text-[10px] text-indigo-200">{employeeCode}</span>
          </div>
          <button
            type="button"
            onClick={onQuickMute}
            className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-105 shadow-md',
              micOn ? 'bg-[#4D4CEF] text-white' : 'bg-white text-[#F03E3E]'
            )}
            title={micOn ? 'Microphone active' : 'Microphone muted'}
          >
            {micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      ) : (
        <>
          <div className="absolute bottom-2 left-2.5 px-2.5 py-0.5 rounded-full bg-[#15161C]/75 backdrop-blur-md border border-white/15 max-w-[68%]">
            <p className="text-[11px] font-semibold text-white truncate">{fullName}</p>
          </div>
          <span
            className={cn(
              'absolute bottom-2 right-2.5 h-6 w-6 rounded-full flex items-center justify-center shadow-md',
              micOn ? 'bg-[#4D4CEF] text-white' : 'bg-white text-[#F03E3E]'
            )}
          >
            {micOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
          </span>
        </>
      )}
    </div>
  )
}

export function LiveMeetingPage({
  meetingIdProp,
  windowMode = 'fullscreen',
  onMinimize,
  onMaximize,
  onCloseCall,
}: LiveMeetingPageProps) {
  const { id: routeParamId = '' } = useParams()
  const meetingId = meetingIdProp || routeParamId
  const { employee, role } = useAuth()
  const { toast } = useToast()

  const [gateState, setGateState] = useState<'checking' | 'denied' | 'waiting_room' | 'prejoin' | 'in_call' | 'ended'>('checking')
  const [denyMessage, setDenyMessage] = useState<string>('')
  const [waitingReason, setWaitingReason] = useState<string>('')
  const [isHost, setIsHost] = useState(false)

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [participants, setParticipants] = useState<MeetingParticipant[]>([])
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRecord[]>([])
  const [allEmployees, setAllEmployees] = useState<Employee[]>([])
  const [messages, setMessages] = useState<MeetingMessage[]>([])
  const [agenda, setAgenda] = useState<MeetingAgendaItem[]>([])

  // Pre-join preferences
  const [preMicOn, setPreMicOn] = useState(true)
  const [preCamOn, setPreCamOn] = useState(true)
  const [enteringCall, setEnteringCall] = useState(false)

  // Calling Window Layout & Collapsible Right Sidebar (collapsed to icons by default!)
  const [layoutMode, setLayoutMode] = useState<'speaker' | 'grid'>('speaker')
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null)
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab | null>(null)
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(Boolean(document.fullscreenElement))
  const [showNotInvited, setShowNotInvited] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteSelected, setInviteSelected] = useState<string[]>([])
  const [inviteSearch, setInviteSearch] = useState('')
  const [inviteDeptFilter, setInviteDeptFilter] = useState('')
  const [chatText, setChatText] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Session Notes state (persisted per meeting in localStorage)
  const [notes, setNotes] = useState<SessionNote[]>([])
  const [noteInput, setNoteInput] = useState('')

  // Client-side MediaRecorder Recording state
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'recording' | 'paused'>('idle')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])

  const chatBottomRef = useRef<HTMLDivElement | null>(null)
  const miniVideoRef = useRef<HTMLVideoElement | null>(null)
  const activeTabRef = useRef<SidebarTab | null>(activeSidebarTab)

  useEffect(() => {
    activeTabRef.current = activeSidebarTab
    if (activeSidebarTab === 'chat') {
      setUnreadChatCount(0)
    }
  }, [activeSidebarTab])

  // Load saved local session notes for this meeting
  useEffect(() => {
    if (!meetingId) return
    try {
      const saved = window.localStorage.getItem(`varta-notes-${meetingId}`)
      if (saved) setNotes(JSON.parse(saved))
    } catch {
      // ignore storage errors
    }
  }, [meetingId])

  const finishAndClose = useCallback(
    (dest: string) => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (onCloseCall) {
        onCloseCall(dest)
      } else {
        window.location.assign(dest)
      }
    },
    [onCloseCall]
  )

  useEffect(() => {
    const handleFsChange = () => {
      setIsBrowserFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  const toggleBrowserFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      toast({
        type: 'info',
        title: 'Expanded Window Active',
        description: 'Your browser blocked OS-level monitor fullscreen.',
      })
    }
  }

  const handleToggleSidebar = (tab: SidebarTab) => {
    setActiveSidebarTab((prev) => (prev === tab ? null : tab))
  }

  const loadRoomState = useCallback(async () => {
    if (!meetingId) return
    const [mtRes, partRes, attRes, msgRes, agRes, empRes] = await Promise.all([
      supabase
        .from('meetings')
        .select('*, organizer:employees!meetings_organizer_id_fkey(id, employee_code, full_name, designation, avatar_url)')
        .eq('id', meetingId)
        .maybeSingle(),
      supabase
        .from('meeting_participants')
        .select('*, employee:employees!meeting_participants_employee_id_fkey(*)')
        .eq('meeting_id', meetingId),
      supabase
        .from('attendance')
        .select('*, employee:employees!attendance_employee_id_fkey(*)')
        .eq('meeting_id', meetingId),
      supabase
        .from('meeting_messages')
        .select('*')
        .eq('meeting_id', meetingId)
        .order('created_at', { ascending: true }),
      supabase
        .from('meeting_agenda')
        .select('*')
        .eq('meeting_id', meetingId)
        .order('position', { ascending: true }),
      supabase
        .from('employees')
        .select('*, department:departments!employees_department_id_fkey(id, name, code), team:teams!employees_team_id_fkey(id, name, department_id)')
        .eq('status', 'active')
        .order('employee_code'),
    ])

    if (mtRes.data) setMeeting(mtRes.data as Meeting)
    setParticipants((partRes.data ?? []) as MeetingParticipant[])
    setAttendanceRows((attRes.data ?? []) as AttendanceRecord[])
    setMessages((msgRes.data ?? []) as MeetingMessage[])
    setAgenda((agRes.data ?? []) as MeetingAgendaItem[])
    setAllEmployees((empRes.data ?? []) as Employee[])
  }, [meetingId])

  const verifyEntryAccess = useCallback(async () => {
    if (!meetingId || !employee) return
    try {
      const res = await invokeEdgeFunction<{
        authorized: boolean
        state: 'admitted' | 'waiting_room'
        reason?: string
        isOrganizer: boolean
        meeting: Meeting
      }>('meeting-access', {
        action: 'join',
        meeting_id: meetingId,
      })
      setMeeting(res.meeting)
      setIsHost(res.isOrganizer || role === 'super_admin')
      await loadRoomState()
      if (res.state === 'waiting_room') {
        setWaitingReason(res.reason || 'waiting_for_admission')
        setGateState('waiting_room')
      } else {
        setGateState((prev) => (prev === 'in_call' ? 'in_call' : 'prejoin'))
      }
    } catch (err) {
      setDenyMessage(err instanceof Error ? err.message : 'Access denied')
      setGateState('denied')
    }
  }, [meetingId, employee, role, loadRoomState])

  useEffect(() => {
    verifyEntryAccess()
  }, [verifyEntryAccess])

  useEffect(() => {
    if (!meetingId || gateState === 'denied' || gateState === 'checking') return

    const ch = supabase
      .channel(`room-db-${meetingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', filter: `id=eq.${meetingId}` }, (payload) => {
        const next = payload.new as Meeting
        if (next) {
          setMeeting((prev) => ({ ...(prev ?? ({} as Meeting)), ...next }))
          if (next.status === 'completed') {
            setGateState('ended')
          } else if (next.status === 'live' && gateState === 'waiting_room') {
            verifyEntryAccess()
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_participants', filter: `meeting_id=eq.${meetingId}` }, (payload) => {
        loadRoomState()
        const row = payload.new as MeetingParticipant
        if (row && row.employee_id === employee?.id) {
          if (row.admission_status === 'admitted' && gateState === 'waiting_room') {
            verifyEntryAccess()
          } else if (row.admission_status === 'rejected' || row.admission_status === 'removed') {
            setDenyMessage('The organizer has removed or denied your access to this meeting.')
            setGateState('denied')
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `meeting_id=eq.${meetingId}` }, () => {
        loadRoomState()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meeting_messages', filter: `meeting_id=eq.${meetingId}` }, (payload) => {
        const msg = payload.new as MeetingMessage
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          return [...prev, msg]
        })
        if (activeTabRef.current !== 'chat' && msg.sender_employee_id !== employee?.id) {
          setUnreadChatCount((c) => c + 1)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_agenda', filter: `meeting_id=eq.${meetingId}` }, () => {
        loadRoomState()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [meetingId, gateState, employee?.id, loadRoomState, verifyEntryAccess])

  const {
    localStream,
    micOn,
    camOn,
    screenSharing,
    handRaised,
    setHandRaised,
    mediaNotice,
    devices,
    selectedAudioId,
    selectedVideoId,
    remotePeers,
    activeSpeakerPeerId,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    sendOrganizerCommand,
    switchMediaDevices,
  } = useWebRTCMeeting({
    meetingId,
    employee,
    joinedRoom: gateState === 'in_call',
    initialMicOn: preMicOn,
    initialCamOn: preCamOn,
    onForcedMute: () =>
      toast({ type: 'warning', title: 'Muted by Organizer', description: 'The meeting host muted your microphone.' }),
    onRemoved: () => {
      setDenyMessage('You were removed from the meeting by the organizer.')
      setGateState('denied')
    },
  })

  const handleConfirmAndEnter = async () => {
    setEnteringCall(true)
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
    try {
      await invokeEdgeFunction('meeting-access', {
        action: 'confirm_entry',
        meeting_id: meetingId,
      })
      setGateState('in_call')
      await loadRoomState()
      toast({
        type: 'success',
        title: 'Entered Meeting & Attendance Marked Present',
        description: 'Distraction-free full screen active. Use the right icon rail for tools.',
      })
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could not enter room',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setEnteringCall(false)
    }
  }

  useEffect(() => {
    if (gateState !== 'in_call' || !meetingId) return
    const interval = window.setInterval(() => {
      invokeEdgeFunction('meeting-access', { action: 'heartbeat', meeting_id: meetingId }).catch(() => {})
    }, 25_000)

    const handleUnload = () => {
      invokeEdgeFunction('meeting-access', { action: 'leave', meeting_id: meetingId }).catch(() => {})
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [gateState, meetingId])

  useEffect(() => {
    if (gateState !== 'in_call' && meeting?.status !== 'live') return
    const updateClock = () => {
      const base = meeting?.actual_started_at ? new Date(meeting.actual_started_at).getTime() : Date.now()
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - base) / 1000)))
    }
    updateClock()
    const t = window.setInterval(updateClock, 1000)
    return () => window.clearInterval(t)
  }, [gateState, meeting?.status, meeting?.actual_started_at])

  // Recording elapsed clock
  useEffect(() => {
    if (recordingStatus !== 'recording') return
    const t = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1)
    }, 1000)
    return () => window.clearInterval(t)
  }, [recordingStatus])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, activeSidebarTab])

  const handleLeaveCall = async (dest = '/my-meetings') => {
    try {
      await invokeEdgeFunction('meeting-access', { action: 'leave', meeting_id: meetingId })
    } catch {
      // ignore
    }
    toast({ type: 'info', title: 'Left Meeting', description: 'Participation duration saved.' })
    finishAndClose(dest)
  }

  const handleEndMeeting = async () => {
    if (!window.confirm('End this meeting for everyone and finalize attendance reports?')) return
    try {
      await invokeEdgeFunction('meeting-access', { action: 'end_meeting', meeting_id: meetingId })
      toast({
        type: 'success',
        title: 'Meeting Ended & Attendance Report Generated',
        description: 'Unjoined invitees have been recorded as Absent.',
      })
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      }
      setGateState('ended')
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could not end meeting',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleCancelMeeting = async () => {
    if (!window.confirm('Are you sure you want to cancel this scheduled meeting? Invited participants will be notified.')) return
    try {
      try {
        await invokeEdgeFunction('meeting-access', { action: 'cancel_meeting', meeting_id: meetingId })
      } catch {
        await supabase.from('meetings').update({ status: 'cancelled' }).eq('id', meetingId)
      }
      toast({
        type: 'info',
        title: 'Meeting Cancelled',
        description: 'Meeting status updated to cancelled.',
      })
      finishAndClose('/my-meetings')
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed to cancel meeting',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleAdmitAction = async (targetEmployeeId: string, action: 'admit' | 'reject' | 'remove') => {
    try {
      await invokeEdgeFunction('meeting-access', {
        action,
        meeting_id: meetingId,
        target_employee_id: targetEmployeeId,
      })
      toast({ type: 'success', title: `Participant ${action}ed` })
      loadRoomState()
    } catch (err) {
      toast({ type: 'error', title: 'Action failed', description: err instanceof Error ? err.message : 'Error' })
    }
  }

  const handleSendChat = async (e: React.FormEvent, quickEmoji?: string) => {
    e.preventDefault()
    const content = (quickEmoji ?? chatText).trim()
    if (!content || !employee) return
    setSendingChat(true)
    try {
      const { error } = await supabase.from('meeting_messages').insert({
        meeting_id: meetingId,
        sender_employee_id: employee.id,
        sender_name: employee.full_name,
        sender_code: getDisplayEmployeeId(employee) ?? 'LEADERSHIP',
        content,
        message_type: quickEmoji ? 'reaction' : 'text',
      })
      if (error) throw error
      if (!quickEmoji) setChatText('')
    } catch (err) {
      toast({ type: 'error', title: 'Chat failed', description: err instanceof Error ? err.message : 'Error' })
    } finally {
      setSendingChat(false)
    }
  }

  const handleInviteMore = async () => {
    if (inviteSelected.length === 0) return
    try {
      await invokeEdgeFunction('meeting-access', {
        action: 'invite_participants',
        meeting_id: meetingId,
        employee_ids: inviteSelected,
      })
      toast({ type: 'success', title: `Invited ${inviteSelected.length} employee(s)` })
      setInviteSelected([])
      setInviteOpen(false)
      loadRoomState()
    } catch (err) {
      toast({ type: 'error', title: 'Invite failed', description: err instanceof Error ? err.message : 'Error' })
    }
  }

  const toggleAgendaComplete = async (item: MeetingAgendaItem) => {
    if (!isHost) return
    await supabase.from('meeting_agenda').update({ is_completed: !item.is_completed }).eq('id', item.id)
    loadRoomState()
  }

  // Session Notes Handlers
  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault()
    if (!noteInput.trim()) return
    const next: SessionNote[] = [
      ...notes,
      {
        id: `${Date.now()}`,
        time: formatClockTimer(elapsedSeconds),
        author: employee?.full_name || 'You',
        text: noteInput.trim(),
      },
    ]
    setNotes(next)
    setNoteInput('')
    try {
      window.localStorage.setItem(`varta-notes-${meetingId}`, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const handleDownloadNotes = () => {
    const content = [
      `Meeting Notes — ${meeting?.title || 'VarTa Call'} (${meeting?.meeting_code || ''})`,
      `Date: ${formatDate(meeting?.scheduled_start)}`,
      '',
      ...notes.map((n) => `[${n.time}] ${n.author}: ${n.text}`),
    ].join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${meeting?.meeting_code || 'meeting'}-notes.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Client-side Recording Handlers (MediaRecorder over active call media stream)
  const handleStartRecording = () => {
    if (!localStream || localStream.getTracks().length === 0) {
      toast({
        type: 'warning',
        title: 'No media tracks available',
        description: 'Enable microphone, camera, or screen share to record this session locally.',
      })
      return
    }
    try {
      if (recordedBlobUrl) {
        URL.revokeObjectURL(recordedBlobUrl)
        setRecordedBlobUrl(null)
      }
      recordedChunksRef.current = []
      const recorder = new MediaRecorder(localStream)
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })
        const url = URL.createObjectURL(blob)
        setRecordedBlobUrl(url)
        setRecordingStatus('idle')
        toast({
          type: 'success',
          title: 'Recording Ready',
          description: 'Open the Recording sidebar panel to download the .webm capture.',
        })
      }
      recorder.start(1000)
      mediaRecorderRef.current = recorder
      setRecordingSeconds(0)
      setRecordingStatus('recording')
      toast({ type: 'info', title: 'Recording Started' })
    } catch {
      toast({
        type: 'error',
        title: 'Recording unsupported',
        description: 'This browser prevented MediaRecorder capture on the current stream.',
      })
    }
  }

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const attendanceMatrix = useMemo(() => {
    const attByEmp = new Map(attendanceRows.map((a) => [a.employee_id, a]))
    const invitedIds = new Set(
      participants.filter((p) => p.admission_status !== 'removed' && p.admission_status !== 'rejected').map((p) => p.employee_id)
    )

    const invitedList = participants
      .filter((p) => p.admission_status !== 'removed' && p.admission_status !== 'rejected' && p.employee)
      .map((p) => {
        const att = attByEmp.get(p.employee_id)
        const status: 'present' | 'waiting' | 'absent' =
          att?.status === 'present'
            ? 'present'
            : p.admission_status === 'waiting' || att?.status === 'waiting'
              ? 'waiting'
              : 'absent'
        return {
          employee: p.employee!,
          status,
          attendance: att,
          admission: p.admission_status,
        }
      })

    if (!showNotInvited) return invitedList

    const notInvitedList = allEmployees
      .filter((e) => !invitedIds.has(e.id))
      .map((e) => ({
        employee: e,
        status: 'not_invited' as const,
        attendance: undefined,
        admission: 'not_invited' as const,
      }))

    return [...invitedList, ...notInvitedList]
  }, [participants, attendanceRows, allEmployees, showNotInvited])

  const attCounts = useMemo(() => {
    return {
      present: attendanceMatrix.filter((r) => r.status === 'present').length,
      absent: attendanceMatrix.filter((r) => r.status === 'absent').length,
      waiting: attendanceMatrix.filter((r) => r.status === 'waiting').length,
    }
  }, [attendanceMatrix])

  const waitingQueue = participants.filter((p) => p.admission_status === 'waiting')

  const videoTiles = useMemo(() => {
    if (!employee) return []
    const selfTile = {
      peerId: 'local',
      employeeId: employee.id,
      employeeCode: getDisplayEmployeeId(employee) ?? 'LEADERSHIP',
      fullName: `${employee.full_name} (You)`,
      avatarUrl: employee.avatar_url,
      micOn,
      camOn: camOn || screenSharing,
      handRaised,
      stream: localStream,
      muted: true,
    }
    const others = remotePeers.map((p) => ({
      peerId: p.peerId,
      employeeId: p.employeeId,
      employeeCode: p.employeeCode,
      fullName: p.fullName,
      avatarUrl: p.avatarUrl,
      micOn: p.micOn,
      camOn: p.camOn || p.screenSharing,
      handRaised: p.handRaised,
      stream: p.stream,
      muted: false,
    }))
    return [selfTile, ...others]
  }, [employee, localStream, micOn, camOn, screenSharing, handRaised, remotePeers])

  const mainStageTile = useMemo(() => {
    if (videoTiles.length === 0) return null
    if (pinnedPeerId) {
      const found = videoTiles.find((t) => t.peerId === pinnedPeerId)
      if (found) return found
    }
    if (activeSpeakerPeerId) {
      const speaker = videoTiles.find((t) => t.peerId === activeSpeakerPeerId)
      if (speaker) return speaker
    }
    return videoTiles.find((t) => t.peerId !== 'local') || videoTiles[0]
  }, [videoTiles, pinnedPeerId, activeSpeakerPeerId])

  const thumbnailTiles = useMemo(() => {
    if (!mainStageTile) return []
    return videoTiles.filter((t) => t.peerId !== mainStageTile.peerId)
  }, [videoTiles, mainStageTile])

  useEffect(() => {
    if (windowMode === 'minimized' && miniVideoRef.current && mainStageTile?.stream) {
      miniVideoRef.current.srcObject = mainStageTile.stream
    }
  }, [windowMode, mainStageTile?.stream])

  const handleExportCsv = () => {
    exportAttendanceCSV(
      attendanceMatrix.map((row) => ({
        employee_code: getDisplayEmployeeId(row.employee) ?? 'LEADERSHIP',
        employee_name: row.employee.full_name,
        email: row.employee.email,
        department: row.employee.department?.name || '—',
        team: row.employee.team?.name || '—',
        meeting_code: meeting?.meeting_code || '',
        meeting_title: meeting?.title || '',
        meeting_date: formatDate(meeting?.scheduled_start),
        status: row.status,
        join_time: row.attendance?.join_time ? formatTime(row.attendance.join_time) : '—',
        leave_time: row.attendance?.leave_time ? formatTime(row.attendance.leave_time) : '—',
        duration_minutes: Math.round((row.attendance?.total_duration_seconds || 0) / 60),
      })),
      `${meeting?.meeting_code || 'meeting'}-live-attendance.csv`
    )
  }

  // Gate Screens (Checking, Restricted, Ended, Waiting Room, Pre-Join)
  if (gateState === 'checking') {
    return (
      <div className="fixed inset-0 z-50 varta-canvas flex flex-col items-center justify-center gap-3">
        <div className="h-10 w-10 rounded-full border-2 border-[#4D4CEF] border-t-transparent animate-spin" />
        <p className="text-sm font-medium text-[#5E647B]">Verifying session & invite authorization...</p>
      </div>
    )
  }

  if (gateState === 'denied') {
    return (
      <div className="fixed inset-0 z-50 varta-canvas flex items-center justify-center p-4">
        <div className="varta-card rounded-[28px] p-8 max-w-md w-full text-center space-y-4 border-rose-200">
          <div className="h-14 w-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto">
            <ShieldAlert className="h-7 w-7 text-rose-600" />
          </div>
          <h1 className="font-display text-xl font-bold text-[#151722]">Meeting Access Restricted</h1>
          <p className="text-sm text-[#5E647B] leading-relaxed">{denyMessage}</p>
          <button
            onClick={() => finishAndClose('/my-meetings')}
            className="w-full py-2.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white"
          >
            Return to My Meetings
          </button>
        </div>
      </div>
    )
  }

  if (gateState === 'ended') {
    return (
      <div className="fixed inset-0 z-50 varta-canvas flex items-center justify-center p-4">
        <div className="varta-card rounded-[28px] p-8 max-w-md w-full text-center space-y-4">
          <div className="h-14 w-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
          </div>
          <h1 className="font-display text-xl font-bold text-[#151722]">Meeting Completed</h1>
          <p className="text-sm text-[#666C85]">
            "{meeting?.title}" has ended and the verified attendance report has been saved.
          </p>
          <div className="flex gap-2.5">
            <button
              onClick={() => finishAndClose(`/attendance?meeting=${meetingId}`)}
              className="flex-1 py-2.5 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold text-white"
            >
              View Attendance Report
            </button>
            <button
              onClick={() => finishAndClose('/dashboard')}
              className="px-4 py-2.5 rounded-full bg-[#F1F3F9] text-xs font-semibold text-[#151722]"
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (gateState === 'waiting_room') {
    return (
      <div className="fixed inset-0 z-50 varta-canvas flex items-center justify-center p-4">
        <div className="varta-card rounded-[28px] p-8 max-w-lg w-full text-center space-y-5 border-amber-200">
          <div className="h-14 w-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
            <Clock className="h-7 w-7 text-amber-600 animate-pulse" />
          </div>
          <div className="space-y-1.5">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              Waiting to Join
            </span>
            <h1 className="font-display text-2xl font-bold text-[#151722] mt-2">{meeting?.title}</h1>
            <p className="text-xs text-[#666C85]">
              {waitingReason === 'waiting_for_start'
                ? 'The organizer has not started this meeting yet. You will enter automatically once started & admitted.'
                : 'Waiting Room is enabled. You will be admitted into the call as soon as the organizer approves.'}
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] text-xs text-[#5E647B]">
            Attendance note: You are currently marked <span className="text-amber-700 font-bold">Waiting to join</span>{' '}
            and will only be marked <span className="text-emerald-700 font-bold">Present</span> after entering the live room.
          </div>
          <button
            onClick={() => finishAndClose('/my-meetings')}
            className="px-5 py-2.5 rounded-full bg-[#F1F3F9] hover:bg-[#E4E7F2] text-xs font-semibold text-[#151722]"
          >
            Leave Waiting Room
          </button>
        </div>
      </div>
    )
  }

  if (gateState === 'prejoin') {
    return (
      <div className="fixed inset-0 z-50 varta-canvas flex items-center justify-center p-4">
        <div className="varta-card rounded-[28px] p-8 max-w-lg w-full space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="font-mono text-xs font-bold text-[#4D4CEF]">{meeting?.meeting_code}</span>
              <h1 className="font-display text-2xl font-bold text-[#151722] mt-1">{meeting?.title}</h1>
              <p className="text-xs text-[#6E748C] mt-1">
                Hosted by {meeting?.organizer?.full_name || 'Organizer'} • {participants.length} invited
              </p>
            </div>
            {meeting && <MeetingStatusBadge status={meeting.status} />}
          </div>

          <div className="p-6 rounded-3xl bg-[#F4F5FA] border border-[#E5E8F2] flex flex-col items-center gap-4">
            <Avatar name={employee?.full_name} src={employee?.avatar_url} size="xl" shape="circle" />
            <p className="text-xs text-[#5E647B]">
              Ready to join as <span className="text-[#151722] font-bold">{employee?.full_name}</span>
              {getDisplayEmployeeId(employee) ? ` (${getDisplayEmployeeId(employee)})` : ' (Leadership)'}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPreMicOn((v) => !v)}
                className={cn(
                  'px-4 py-2 rounded-full border text-xs font-semibold flex items-center gap-2 transition-colors',
                  preMicOn ? 'bg-[#4D4CEF] border-[#4D4CEF] text-white' : 'bg-white border-rose-200 text-rose-600'
                )}
              >
                {preMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                Mic {preMicOn ? 'On' : 'Muted'}
              </button>
              <button
                type="button"
                onClick={() => setPreCamOn((v) => !v)}
                className={cn(
                  'px-4 py-2 rounded-full border text-xs font-semibold flex items-center gap-2 transition-colors',
                  preCamOn ? 'bg-[#4D4CEF] border-[#4D4CEF] text-white' : 'bg-white border-rose-200 text-rose-600'
                )}
              >
                {preCamOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                Camera {preCamOn ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => finishAndClose('/my-meetings')}
              className="px-5 py-2.5 rounded-full bg-[#F1F3F9] hover:bg-[#E4E7F2] text-xs font-semibold text-[#454A62]"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmAndEnter}
              disabled={enteringCall}
              className="flex-1 py-2.5 px-5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-xs font-semibold text-white shadow-[0_10px_22px_-8px_rgba(21,22,28,0.45)]"
            >
              {enteringCall
                ? 'Entering Room...'
                : meeting?.status === 'scheduled' && isHost
                  ? 'Start Meeting & Enter Full Screen'
                  : 'Enter Full Screen Room'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const uninvitedEmployees = allEmployees.filter(
    (e) => !participants.some((p) => p.employee_id === e.id && p.admission_status !== 'removed')
  )
  const invitedParticipants = participants.filter((p) => p.admission_status !== 'removed' && p.admission_status !== 'rejected')

  const sidebarItems: {
    id: SidebarTab
    label: string
    icon: React.ComponentType<{ className?: string }>
    badge?: number
    pulseColor?: 'emerald' | 'rose'
  }[] = [
    { id: 'participants', label: 'Participants', icon: Users, badge: invitedParticipants.length || videoTiles.length },
    { id: 'chat', label: 'Chat', icon: MessageSquare, badge: unreadChatCount > 0 ? unreadChatCount : undefined },
    { id: 'details', label: 'Meeting Details', icon: Info },
    { id: 'notes', label: 'Notes', icon: FileText, badge: notes.length > 0 ? notes.length : undefined },
    { id: 'screenshare', label: 'Screen Sharing', icon: MonitorUp, pulseColor: screenSharing ? 'emerald' : undefined },
    { id: 'recording', label: 'Recording', icon: Radio, pulseColor: recordingStatus === 'recording' ? 'rose' : undefined },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  // Minimized Floating PiP Window
  if (windowMode === 'minimized') {
    const miniHasVideo = Boolean(
      mainStageTile?.stream && mainStageTile.stream.getVideoTracks().some((t) => t.enabled)
    )
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="fixed bottom-4 right-4 z-50 w-[320px] sm:w-[375px] rounded-[26px] bg-white/95 backdrop-blur-2xl border border-[#DFE3F2] shadow-[0_24px_60px_-12px_rgba(24,27,68,0.28)] overflow-hidden"
      >
        <div className="px-3.5 py-2.5 border-b border-[#EEF0F7] bg-[#F8F9FD] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#15161C] text-[10px] font-mono font-bold text-white shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-[#F03E3E] animate-pulse" />
              {formatClockTimer(elapsedSeconds)}
            </span>
            <p className="text-xs font-bold text-[#151722] truncate">{meeting?.title}</p>
          </div>

          <button
            onClick={onMaximize}
            title="Expand to Full Screen"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-[11px] font-semibold text-white shadow-xs transition-transform hover:scale-[1.03]"
          >
            <Maximize2 className="h-3 w-3" />
            <span>Expand</span>
          </button>
        </div>

        <div className="p-2.5 bg-white">
          <div className="relative h-44 rounded-[18px] overflow-hidden bg-gradient-to-br from-[#EAECF7] via-[#E1E4F4] to-[#ECE7F8] border border-[#E3E6F2] flex items-center justify-center">
            {miniHasVideo ? (
              <video
                ref={miniVideoRef}
                autoPlay
                playsInline
                muted={mainStageTile?.muted ?? true}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <Avatar name={mainStageTile?.fullName} src={mainStageTile?.avatarUrl} size="lg" shape="circle" />
                <span className="text-[10px] font-semibold text-[#5E647B]">Camera off</span>
              </div>
            )}

            <div className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-full bg-[#15161C]/75 backdrop-blur-md text-[10px] font-semibold text-white max-w-[70%] truncate">
              {mainStageTile?.fullName || employee?.full_name}
            </div>
            <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-white/90 text-[10px] font-bold text-[#4D4CEF] shadow-2xs">
              {attCounts.present}/{attendanceMatrix.length} Present
            </span>
          </div>
        </div>

        <div className="px-3.5 py-2.5 border-t border-[#EEF0F7] bg-[#F8F9FD] flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleMic}
              className={cn(
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
                micOn ? 'bg-[#15161C] text-white' : 'bg-rose-50 border border-rose-200 text-[#F03E3E]'
              )}
            >
              {micOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
              <span>{micOn ? 'Mic' : 'Muted'}</span>
            </button>
            <button
              onClick={toggleCam}
              className={cn(
                'h-8 w-8 rounded-full flex items-center justify-center transition-all',
                camOn ? 'bg-[#4D4CEF] text-white' : 'bg-white border border-[#E5E8F2] text-[#F03E3E]'
              )}
              title={camOn ? 'Camera off' : 'Camera on'}
            >
              {camOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
            </button>
          </div>

          {isHost ? (
            <button
              onClick={handleEndMeeting}
              className="px-3 py-1.5 rounded-full bg-[#F03E3E] hover:bg-[#E03131] text-[11px] font-bold text-white"
            >
              End
            </button>
          ) : (
            <button
              onClick={() => handleLeaveCall('/my-meetings')}
              className="px-3 py-1.5 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-[11px] font-bold text-[#F03E3E]"
            >
              Leave
            </button>
          )}
        </div>
      </motion.div>
    )
  }

  // Full-Screen Calling Window + Minimal Collapsible Right Icon Sidebar (Collapsed by Default!)
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-50 h-screen w-screen varta-canvas text-[#151722] overflow-hidden flex flex-col p-2.5 sm:p-3.5 lg:p-4 gap-3"
    >
      {mediaNotice && (
        <div className="w-full px-4 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800 text-center shrink-0">
          {mediaNotice}
        </div>
      )}

      {/* Main Horizontal Stage: Expanded Video Window + Sliding Panel + Slim Collapsed Right Rail */}
      <div className="flex-1 min-h-0 w-full flex items-stretch gap-3">
        {/* MAIN DISTRACTION-FREE VIDEO CALLING WINDOW (Occupies maximum space) */}
        <div className="flex-1 min-w-0 h-full min-h-0 flex flex-col items-center gap-2.5">
          <div className="w-full flex-1 min-h-0 rounded-[28px] bg-white p-3 sm:p-4 lg:p-5 shadow-[0_24px_65px_-18px_rgba(32,38,88,0.16)] border border-[#E6E8F2] flex flex-col gap-3">
            {/* Compact Top Calling Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => handleLeaveCall('/dashboard')}
                  title="Back to Dashboard"
                  className="h-9 w-9 rounded-full bg-[#F3F4FA] hover:bg-[#E7EAF5] border border-[#E5E8F2] flex items-center justify-center text-[#454A62] transition-colors shrink-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <h1 className="font-display text-base sm:text-lg font-bold text-[#151722] tracking-tight truncate">
                    {meeting?.title || 'Live Meeting'}
                  </h1>
                  <p className="text-[11px] sm:text-xs text-[#7D839B] truncate">
                    Hosted by <span className="text-[#151722] font-semibold">{meeting?.organizer?.full_name || 'Organizer'}</span> •{' '}
                    <span className="font-mono text-[#4D4CEF] font-semibold">{meeting?.meeting_code}</span> • {videoTiles.length} joined
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href)
                    toast({ type: 'info', title: 'Meeting room link copied' })
                  }}
                  title="Copy invite link"
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F3F4FA] hover:bg-[#E7EAF5] border border-[#E5E8F2] text-xs font-semibold text-[#454A62] transition-colors"
                >
                  <Copy className="h-3.5 w-3.5 text-[#4D4CEF]" />
                  <span>Copy Link</span>
                </button>

                {onMinimize && (
                  <button
                    onClick={onMinimize}
                    title="Minimize calling window"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F3F4FA] hover:bg-[#E7EAF5] border border-[#E5E8F2] text-xs font-semibold text-[#151722] transition-colors"
                  >
                    <Minimize2 className="h-3.5 w-3.5 text-[#4D4CEF]" />
                    <span className="hidden sm:inline">Minimize</span>
                  </button>
                )}

                <button
                  onClick={toggleBrowserFullscreen}
                  title={isBrowserFullscreen ? 'Exit browser fullscreen' : 'OS Fullscreen'}
                  className="p-2 rounded-full bg-[#F3F4FA] hover:bg-[#E7EAF5] border border-[#E5E8F2] text-[#454A62] transition-colors"
                >
                  {isBrowserFullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
                </button>

                {isHost ? (
                  <div className="flex items-center gap-2">
                    {meeting?.status === 'scheduled' && (
                      <button
                        onClick={handleCancelMeeting}
                        className="px-3.5 sm:px-4 py-2 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-bold text-[#F03E3E] transition-all hover:scale-[1.02]"
                        title="Cancel this scheduled meeting"
                      >
                        Cancel Meeting
                      </button>
                    )}
                    <button
                      onClick={handleEndMeeting}
                      className="px-4 sm:px-5 py-2 rounded-full bg-[#F03E3E] hover:bg-[#E03131] text-xs font-bold text-white shadow-[0_10px_22px_-6px_rgba(240,62,62,0.45)] transition-all hover:scale-[1.02]"
                    >
                      {meeting?.status === 'scheduled' ? 'Cancel / End' : 'End Now'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleLeaveCall('/my-meetings')}
                    className="px-4 sm:px-5 py-2 rounded-full bg-[#F03E3E] hover:bg-[#E03131] text-xs font-bold text-white shadow-[0_10px_22px_-6px_rgba(240,62,62,0.45)] transition-all hover:scale-[1.02]"
                  >
                    Leave Call
                  </button>
                )}
              </div>
            </div>

            {/* Large Prominent Video Stage */}
            <div className="flex-1 min-h-0">
              {layoutMode === 'grid' ? (
                <div
                  className={cn(
                    'grid gap-3 h-full',
                    videoTiles.length === 1 ? 'grid-cols-1' : videoTiles.length <= 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
                  )}
                >
                  {videoTiles.map((tile) => (
                    <CallingVideoTile
                      key={tile.peerId}
                      stream={tile.stream}
                      muted={tile.muted}
                      fullName={tile.fullName}
                      employeeCode={tile.employeeCode}
                      avatarUrl={tile.avatarUrl}
                      micOn={tile.micOn}
                      camOn={tile.camOn}
                      handRaised={tile.handRaised}
                      isActiveSpeaker={activeSpeakerPeerId === tile.peerId}
                      isPinned={pinnedPeerId === tile.peerId}
                      isPrimary={videoTiles.length === 1}
                      elapsedText={videoTiles.length === 1 ? formatClockTimer(elapsedSeconds) : undefined}
                      isRecording={videoTiles.length === 1 && recordingStatus === 'recording'}
                      onPin={() => setPinnedPeerId(pinnedPeerId === tile.peerId ? null : tile.peerId)}
                      onToggleLayout={videoTiles.length === 1 ? () => setLayoutMode('speaker') : undefined}
                      onQuickMute={tile.peerId === 'local' ? toggleMic : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col lg:flex-row gap-3 h-full min-h-0">
                  {/* Prominent Center Active Speaker */}
                  {mainStageTile && (
                    <div className="flex-1 min-w-0 h-full min-h-0">
                      <CallingVideoTile
                        isPrimary
                        stream={mainStageTile.stream}
                        muted={mainStageTile.muted}
                        fullName={mainStageTile.fullName}
                        employeeCode={mainStageTile.employeeCode}
                        avatarUrl={mainStageTile.avatarUrl}
                        micOn={mainStageTile.micOn}
                        camOn={mainStageTile.camOn}
                        handRaised={mainStageTile.handRaised}
                        isActiveSpeaker={activeSpeakerPeerId === mainStageTile.peerId}
                        isPinned={pinnedPeerId === mainStageTile.peerId}
                        elapsedText={formatClockTimer(elapsedSeconds)}
                        isRecording={recordingStatus === 'recording'}
                        onToggleLayout={() => setLayoutMode((m) => (m === 'speaker' ? 'grid' : 'speaker'))}
                        onQuickMute={mainStageTile.peerId === 'local' ? toggleMic : undefined}
                      />
                    </div>
                  )}

                  {/* Compact Other Participants Strip */}
                  {thumbnailTiles.length > 0 && (
                    <div className="lg:w-[230px] xl:w-[260px] shrink-0 grid grid-cols-2 lg:grid-cols-1 lg:auto-rows-fr gap-3 max-h-[150px] lg:max-h-full overflow-y-auto">
                      {thumbnailTiles.slice(0, 4).map((tile) => (
                        <CallingVideoTile
                          key={tile.peerId}
                          stream={tile.stream}
                          muted={tile.muted}
                          fullName={tile.fullName}
                          employeeCode={tile.employeeCode}
                          avatarUrl={tile.avatarUrl}
                          micOn={tile.micOn}
                          camOn={tile.camOn}
                          handRaised={tile.handRaised}
                          isActiveSpeaker={activeSpeakerPeerId === tile.peerId}
                          isPinned={pinnedPeerId === tile.peerId}
                          onPin={() => setPinnedPeerId(tile.peerId)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Primary Media Control Pill Dock (Clean, non-intrusive) */}
          <div className="shrink-0 rounded-full bg-white/92 backdrop-blur-2xl border border-white px-4 py-2 shadow-[0_16px_42px_-12px_rgba(32,38,88,0.18)] flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
            <button
              onClick={toggleMic}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all',
                micOn
                  ? 'bg-[#15161C] hover:bg-[#262835] text-white shadow-sm'
                  : 'bg-rose-50 border border-rose-200 text-[#F03E3E]'
              )}
            >
              {micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              <span>{micOn ? 'Mute' : 'Muted'}</span>
            </button>

            <button
              onClick={toggleCam}
              title={camOn ? 'Turn camera off' : 'Turn camera on'}
              className={cn(
                'h-9 w-9 rounded-full flex items-center justify-center transition-all',
                camOn ? 'bg-[#4D4CEF] text-white shadow-xs' : 'bg-[#F3F4F9] text-[#F03E3E] hover:bg-rose-50'
              )}
            >
              {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>

            <button
              onClick={toggleScreenShare}
              title={screenSharing ? 'Stop screen share' : 'Start screen share'}
              className={cn(
                'h-9 w-9 rounded-full flex items-center justify-center transition-all',
                screenSharing ? 'bg-emerald-600 text-white shadow-xs' : 'bg-[#F3F4F9] hover:bg-[#E7EAF5] text-[#151722]'
              )}
            >
              <MonitorUp className="h-4 w-4" />
            </button>

            <button
              onClick={() => setHandRaised((v) => !v)}
              title={handRaised ? 'Lower hand' : 'Raise hand'}
              className={cn(
                'h-9 w-9 rounded-full flex items-center justify-center transition-all',
                handRaised ? 'bg-amber-400 text-[#151722] shadow-xs' : 'bg-[#F3F4F9] hover:bg-[#E7EAF5] text-[#151722]'
              )}
            >
              <Hand className="h-4 w-4" />
            </button>

            <span className="h-5 w-px bg-[#E5E8F2] mx-0.5" />

            <button
              onClick={() => setLayoutMode((m) => (m === 'speaker' ? 'grid' : 'speaker'))}
              title="Switch video layout"
              className="h-9 w-9 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] flex items-center justify-center text-[#151722] transition-all"
            >
              {layoutMode === 'speaker' ? <LayoutGrid className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>

            <button
              onClick={() => handleLeaveCall('/my-meetings')}
              title="Leave meeting"
              className="h-9 w-9 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 flex items-center justify-center text-[#F03E3E] transition-all"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* SLIDE-IN GLASSMORPHIC TOOL PANEL (Opens only when a sidebar icon is clicked) */}
        <AnimatePresence mode="wait">
          {activeSidebarTab && (
            <motion.aside
              key={activeSidebarTab}
              initial={{ opacity: 0, x: 28, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 340 }}
              exit={{ opacity: 0, x: 24, width: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-y-3 right-16 z-40 md:static md:inset-auto max-w-[calc(100vw-5.5rem)] shrink-0 h-[calc(100vh-1.5rem)] md:h-full min-h-0 rounded-[26px] bg-white/88 backdrop-blur-2xl border border-white shadow-[0_22px_60px_-14px_rgba(32,38,88,0.20)] flex flex-col overflow-hidden"
            >
              {/* Drawer Header */}
              <div className="px-4 py-3.5 border-b border-[#EEF0F7] bg-[#F8F9FD]/90 flex items-center justify-between gap-2 shrink-0">
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-bold text-[#151722] truncate">
                    {sidebarItems.find((i) => i.id === activeSidebarTab)?.label}
                  </h2>
                  <p className="text-[11px] text-[#7D839B] truncate">{meeting?.meeting_code} workspace tool</p>
                </div>
                <button
                  onClick={() => setActiveSidebarTab(null)}
                  title="Close panel"
                  className="h-8 w-8 rounded-full bg-white hover:bg-[#EFF1F8] border border-[#E5E8F2] flex items-center justify-center text-[#5E647B] hover:text-[#151722] transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* PANEL 1: PARTICIPANTS & LIVE ATTENDANCE */}
              {activeSidebarTab === 'participants' && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="p-3.5 border-b border-[#EEF0F7] bg-[#FAFBFD] space-y-2.5 shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                          {attCounts.present} Joined / Present
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                          {attCounts.absent} Absent
                        </span>
                      </div>
                      {isHost && (
                        <button
                          onClick={() => setInviteOpen(true)}
                          title="Add employee to call"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-[10px] font-bold text-white"
                        >
                          <Plus className="h-3 w-3" /> Invite
                        </button>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-medium text-[#5E647B] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showNotInvited}
                        onChange={(e) => setShowNotInvited(e.target.checked)}
                        className="rounded border-[#CFD4E6] text-[#4D4CEF]"
                      />
                      Show uninvited company employees
                    </label>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
                    {isHost && waitingQueue.length > 0 && (
                      <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
                        <p className="text-xs font-bold text-amber-900">Waiting Room ({waitingQueue.length})</p>
                        {waitingQueue.map((wp) => (
                          <div key={wp.id} className="flex items-center justify-between gap-2 bg-white p-2 rounded-xl border border-amber-200">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#151722] truncate">{wp.employee?.full_name}</p>
                              <p className="text-[10px] font-mono text-amber-700">
                                {getDisplayEmployeeId(wp.employee) ?? 'LEADERSHIP'}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleAdmitAction(wp.employee_id, 'admit')}
                                className="p-1.5 rounded-full bg-emerald-50 text-emerald-700"
                                title="Admit"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleAdmitAction(wp.employee_id, 'reject')}
                                className="p-1.5 rounded-full bg-rose-50 text-rose-700"
                                title="Deny"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {attendanceMatrix.map((row) => {
                      const isAbsent = row.status === 'absent'
                      const isSelf = row.employee.id === employee?.id
                      const livePeer = remotePeers.find((rp) => rp.employeeId === row.employee.id)
                      return (
                        <div
                          key={row.employee.id}
                          className="p-2.5 rounded-2xl bg-[#F7F8FC] border border-[#EAEDF6] flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar
                              name={row.employee.full_name}
                              src={row.employee.avatar_url}
                              size="xs"
                              shape="circle"
                              statusDot={
                                row.status === 'present'
                                  ? 'present'
                                  : row.status === 'waiting'
                                    ? 'waiting'
                                    : row.status === 'absent'
                                      ? 'absent'
                                      : null
                              }
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#151722] truncate">
                                {row.employee.full_name} {isSelf && '(You)'}
                              </p>
                              <span
                                className={cn(
                                  'inline-block font-mono text-[10px] px-1.5 py-0.5 rounded-full border mt-0.5',
                                  isAbsent
                                    ? 'bg-rose-50 text-rose-700 border-rose-200 font-bold'
                                    : 'bg-white text-[#4D4CEF] border-[#DFE3F2] font-semibold'
                                )}
                              >
                                {getDisplayEmployeeId(row.employee) ?? 'LEADERSHIP'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <AttendanceStatusBadge status={row.status} />
                            {isHost && !isSelf && row.status !== 'not_invited' && (
                              <div className="flex items-center gap-1 ml-1">
                                {livePeer && (
                                  <button
                                    onClick={() => sendOrganizerCommand(row.employee.id, 'mute')}
                                    title="Mute participant"
                                    className="p-1.5 rounded-full bg-white hover:bg-amber-50 border border-[#E5E8F2] text-[#5E647B] hover:text-amber-700"
                                  >
                                    <VolumeX className="h-3 w-3" />
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    sendOrganizerCommand(row.employee.id, 'remove')
                                    handleAdmitAction(row.employee.id, 'remove')
                                  }}
                                  title="Remove from meeting"
                                  className="p-1.5 rounded-full bg-white hover:bg-rose-50 border border-[#E5E8F2] text-[#5E647B] hover:text-rose-700"
                                >
                                  <UserMinus className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {isHost && (
                    <div className="p-3.5 border-t border-[#EEF0F7] bg-[#F8F9FD] shrink-0">
                      <button
                        onClick={handleExportCsv}
                        className="w-full py-2.5 px-4 rounded-full bg-gradient-to-r from-[#9C65E5] to-[#4D4CEF] hover:opacity-95 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export Attendance CSV
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* PANEL 2: LIVE CHAT */}
              {activeSidebarTab === 'chat' && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                    {messages.map((m) => {
                      const isMine = m.sender_employee_id === employee?.id
                      if (m.message_type === 'system') {
                        return (
                          <div key={m.id} className="text-center text-[11px] font-medium text-[#8D92A8] py-1">
                            {m.content}
                          </div>
                        )
                      }
                      return (
                        <div key={m.id} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-[#151722]">
                              {isMine ? 'You' : m.sender_name}{' '}
                              <span className="font-mono text-[10px] font-semibold text-[#4D4CEF]">{m.sender_code}</span>
                            </span>
                            <span className="font-mono text-[10px] text-[#8D92A8]">{formatTime(m.created_at)}</span>
                          </div>
                          <div
                            className={cn(
                              'px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-2xs',
                              isMine
                                ? 'bg-gradient-to-r from-[#4D4CEF] to-[#8C56DC] text-white'
                                : 'bg-[#F3F4FA] border border-[#E5E8F2] text-[#151722]'
                            )}
                          >
                            {m.content}
                          </div>
                        </div>
                      )
                    })}
                    <div ref={chatBottomRef} />
                  </div>

                  <div className="p-3.5 border-t border-[#EEF0F7] space-y-2 bg-[#F8F9FD] shrink-0">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                      {['👍', '👏', '🔥', '✅', '🙌'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={(e) => handleSendChat(e, emoji)}
                          className="px-2.5 py-1 rounded-full bg-white hover:bg-[#EFF1F8] border border-[#E5E8F2] text-xs transition-transform hover:scale-110"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <form onSubmit={(e) => handleSendChat(e)} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={chatText}
                        onChange={(e) => setChatText(e.target.value)}
                        placeholder="Write chat message..."
                        className="varta-input flex-1 px-3.5 py-2 rounded-full text-xs bg-white"
                      />
                      <button
                        type="submit"
                        disabled={sendingChat || !chatText.trim()}
                        className="p-2.5 rounded-full bg-gradient-to-r from-[#9C65E5] to-[#4D4CEF] hover:opacity-95 disabled:opacity-40 text-white shadow-sm"
                        aria-label="Send chat message"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {/* PANEL 3: MEETING DETAILS & AGENDA */}
              {activeSidebarTab === 'details' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  <div className="p-4 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-[#4D4CEF] bg-white px-2.5 py-0.5 rounded-full border border-[#DFE3F2]">
                        {meeting?.meeting_code}
                      </span>
                      {meeting && <MeetingStatusBadge status={meeting.status} />}
                    </div>
                    <h3 className="font-display text-sm font-bold text-[#151722]">{meeting?.title}</h3>
                    {meeting?.description && <p className="text-[#5E647B] leading-relaxed">{meeting.description}</p>}
                    <div className="pt-2 border-t border-[#E6E8F2] space-y-1.5 text-[#5E647B]">
                      <p>
                        <span className="font-semibold text-[#151722]">Host:</span> {meeting?.organizer?.full_name}
                      </p>
                      <p>
                        <span className="font-semibold text-[#151722]">Scheduled:</span> {formatDateTime(meeting?.scheduled_start)}
                      </p>
                      <p>
                        <span className="font-semibold text-[#151722]">Planned Duration:</span> {meeting?.duration_minutes} mins
                      </p>
                      <p>
                        <span className="font-semibold text-[#151722]">Live Elapsed:</span>{' '}
                        <span className="font-mono font-bold text-[#4D4CEF]">{formatClockTimer(elapsedSeconds)}</span>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.href)
                      toast({ type: 'info', title: 'Invite link copied to clipboard' })
                    }}
                    className="w-full py-2.5 px-4 rounded-full bg-[#15161C] hover:bg-[#262835] text-white font-semibold flex items-center justify-center gap-2"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Joining URL
                  </button>

                  <div className="space-y-2 pt-2">
                    <p className="font-bold text-[#151722]">Meeting Agenda ({agenda.length})</p>
                    {agenda.length === 0 ? (
                      <p className="text-[#8D92A8]">No agenda topics attached.</p>
                    ) : (
                      agenda.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => toggleAgendaComplete(item)}
                          className={cn(
                            'w-full p-3 rounded-2xl border text-left transition-colors',
                            item.is_completed
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                              : 'bg-[#F7F8FC] border-[#EAEDF6] text-[#151722]'
                          )}
                        >
                          <div className="flex justify-between font-bold">
                            <span>
                              #{item.position} {item.title}
                            </span>
                            <span className="font-mono text-[#7D839B]">{item.duration_minutes}m</span>
                          </div>
                          <p className="text-[11px] text-[#6E748C] mt-0.5">{item.presenter_name}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* PANEL 4: NOTES */}
              {activeSidebarTab === 'notes' && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                    {notes.length === 0 ? (
                      <div className="p-6 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] text-center space-y-1.5">
                        <FileText className="h-6 w-6 text-[#8D92A8] mx-auto" />
                        <p className="text-xs font-semibold text-[#151722]">No session notes yet</p>
                        <p className="text-[11px] text-[#7D839B]">Add timestamped meeting takeaways below.</p>
                      </div>
                    ) : (
                      notes.map((n) => (
                        <div key={n.id} className="p-3 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="font-bold text-[#4D4CEF]">{n.author}</span>
                            <span className="font-mono text-[#8D92A8]">{n.time}</span>
                          </div>
                          <p className="text-xs text-[#151722] leading-relaxed">{n.text}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="p-3.5 border-t border-[#EEF0F7] bg-[#F8F9FD] space-y-2.5 shrink-0">
                    <form onSubmit={handleAddNote} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={noteInput}
                        onChange={(e) => setNoteInput(e.target.value)}
                        placeholder="Add timestamped note..."
                        className="varta-input flex-1 px-3.5 py-2 rounded-full text-xs bg-white"
                      />
                      <button
                        type="submit"
                        disabled={!noteInput.trim()}
                        className="px-3.5 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] disabled:opacity-40 text-xs font-semibold text-white"
                      >
                        Save
                      </button>
                    </form>
                    {notes.length > 0 && (
                      <button
                        onClick={handleDownloadNotes}
                        className="w-full py-2 px-4 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download Notes (.txt)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* PANEL 5: SCREEN SHARING */}
              {activeSidebarTab === 'screenshare' && (
                <div className="flex-1 p-4 space-y-4 text-xs">
                  <div className="p-5 rounded-3xl bg-[#F6F7FB] border border-[#E6E8F2] text-center space-y-3">
                    <div
                      className={cn(
                        'h-12 w-12 rounded-2xl mx-auto flex items-center justify-center',
                        screenSharing ? 'bg-emerald-50 text-emerald-600' : 'bg-[#4D4CEF]/10 text-[#4D4CEF]'
                      )}
                    >
                      <MonitorUp className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="font-display text-sm font-bold text-[#151722]">
                        {screenSharing ? 'Screen Share Active' : 'Share Your Screen'}
                      </p>
                      <p className="text-[#6E748C] mt-1 leading-relaxed">
                        {screenSharing
                          ? 'Your screen or application window is currently streaming to all admitted participants via WebRTC.'
                          : 'Present slides, documents, or entire displays to everyone in the room.'}
                      </p>
                    </div>
                    <button
                      onClick={toggleScreenShare}
                      className={cn(
                        'w-full py-2.5 px-4 rounded-full font-semibold text-white transition-all',
                        screenSharing ? 'bg-[#F03E3E] hover:bg-[#E03131]' : 'bg-[#4D4CEF] hover:bg-[#3E3EE0]'
                      )}
                    >
                      {screenSharing ? 'Stop Sharing Screen' : 'Start Screen Share'}
                    </button>
                  </div>
                </div>
              )}

              {/* PANEL 6: RECORDING */}
              {activeSidebarTab === 'recording' && (
                <div className="flex-1 p-4 space-y-4 text-xs">
                  <div className="p-5 rounded-3xl bg-[#F6F7FB] border border-[#E6E8F2] text-center space-y-3">
                    <div
                      className={cn(
                        'h-12 w-12 rounded-2xl mx-auto flex items-center justify-center',
                        recordingStatus === 'recording' ? 'bg-rose-50 text-[#F03E3E]' : 'bg-[#9C65E5]/12 text-[#854DD1]'
                      )}
                    >
                      <Radio className={cn('h-6 w-6', recordingStatus === 'recording' && 'animate-pulse')} />
                    </div>
                    <div>
                      <p className="font-display text-sm font-bold text-[#151722]">
                        {recordingStatus === 'recording' ? 'Recording in Progress' : 'Local Meeting Recording'}
                      </p>
                      <p className="font-mono text-lg font-bold text-[#4D4CEF] mt-1">
                        {formatClockTimer(recordingSeconds)}
                      </p>
                      <p className="text-[#6E748C] mt-1 leading-relaxed">
                        Captures your active call video/screen stream into a downloadable WebM file.
                      </p>
                    </div>

                    {recordingStatus === 'idle' ? (
                      <button
                        onClick={handleStartRecording}
                        className="w-full py-2.5 px-4 rounded-full bg-[#15161C] hover:bg-[#262835] text-white font-semibold flex items-center justify-center gap-2"
                      >
                        <CircleDot className="h-3.5 w-3.5 text-[#F03E3E]" />
                        Start Recording
                      </button>
                    ) : (
                      <button
                        onClick={handleStopRecording}
                        className="w-full py-2.5 px-4 rounded-full bg-[#F03E3E] hover:bg-[#E03131] text-white font-semibold flex items-center justify-center gap-2"
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                        Stop Recording
                      </button>
                    )}
                  </div>

                  {recordedBlobUrl && (
                    <a
                      href={recordedBlobUrl}
                      download={`${meeting?.meeting_code || 'meeting'}-recording.webm`}
                      className="w-full py-2.5 px-4 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Recording (.webm)
                    </a>
                  )}
                </div>
              )}

              {/* PANEL 7: SETTINGS (Audio/Video Devices & View Preferences) */}
              {activeSidebarTab === 'settings' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                  <div>
                    <label className="block text-[#454A62] font-semibold mb-1.5">Microphone Input</label>
                    <select
                      value={selectedAudioId}
                      onChange={(e) => switchMediaDevices(e.target.value, selectedVideoId)}
                      className="varta-select w-full px-3 py-2.5 rounded-2xl"
                    >
                      <option value="">Default Microphone</option>
                      {devices.audioInputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[#454A62] font-semibold mb-1.5">Camera Input</label>
                    <select
                      value={selectedVideoId}
                      onChange={(e) => switchMediaDevices(selectedAudioId, e.target.value)}
                      className="varta-select w-full px-3 py-2.5 rounded-2xl"
                    >
                      <option value="">Default Camera</option>
                      {devices.videoInputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-2 border-t border-[#EEF0F7] space-y-2.5">
                    <p className="font-bold text-[#151722]">Stage & Window Controls</p>
                    <button
                      onClick={() => setLayoutMode((m) => (m === 'speaker' ? 'grid' : 'speaker'))}
                      className="w-full py-2.5 px-4 rounded-full bg-[#F3F4FA] hover:bg-[#E7EAF5] font-semibold text-[#151722] flex items-center justify-between"
                    >
                      <span>Video Layout</span>
                      <span className="text-[#4D4CEF] capitalize">{layoutMode} View</span>
                    </button>

                    <button
                      onClick={toggleBrowserFullscreen}
                      className="w-full py-2.5 px-4 rounded-full bg-[#F3F4FA] hover:bg-[#E7EAF5] font-semibold text-[#151722] flex items-center justify-between"
                    >
                      <span>OS Monitor Fullscreen</span>
                      <span className="text-[#4D4CEF]">{isBrowserFullscreen ? 'Active' : 'Enter'}</span>
                    </button>

                    {onMinimize && (
                      <button
                        onClick={onMinimize}
                        className="w-full py-2.5 px-4 rounded-full bg-[#F3F4FA] hover:bg-[#E7EAF5] font-semibold text-[#151722] flex items-center justify-between"
                      >
                        <span>Minimize Floating Window</span>
                        <Minimize2 className="h-3.5 w-3.5 text-[#4D4CEF]" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* SLIM COLLAPSED RIGHT-EDGE ICON SIDEBAR (Collapsed by Default, Glassmorphic, Tooltips + Badges) */}
        <nav
          aria-label="Meeting sidebar tools"
          className="shrink-0 h-full rounded-[24px] bg-white/78 backdrop-blur-2xl border border-white shadow-[0_14px_38px_-12px_rgba(32,38,88,0.14)] p-2 flex flex-col items-center justify-between gap-2 z-50"
        >
          <div className="flex flex-col items-center gap-2">
            {sidebarItems.map((item) => {
              const Icon = item.icon
              const isActive = activeSidebarTab === item.id
              return (
                <div key={item.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => handleToggleSidebar(item.id)}
                    aria-label={item.label}
                    aria-expanded={isActive}
                    className={cn(
                      'relative h-10 w-10 rounded-2xl flex items-center justify-center transition-all duration-200',
                      isActive
                        ? 'bg-[#4D4CEF] text-white shadow-[0_8px_20px_-6px_rgba(77,76,239,0.55)] scale-[1.05]'
                        : 'bg-[#F5F6FB]/90 text-[#454A62] hover:bg-white hover:text-[#4D4CEF] hover:scale-105 hover:shadow-sm'
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    {item.badge !== undefined && (
                      <span
                        className={cn(
                          'absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ring-2 ring-white',
                          isActive ? 'bg-[#15161C] text-white' : 'bg-[#4D4CEF] text-white'
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                    {item.pulseColor === 'emerald' && (
                      <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse ring-2 ring-white" />
                    )}
                    {item.pulseColor === 'rose' && (
                      <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#F03E3E] animate-pulse ring-2 ring-white" />
                    )}
                  </button>

                  {/* Hover Label Pill Tooltip */}
                  <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute right-12 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full bg-[#15161C] text-white text-[11px] font-semibold whitespace-nowrap shadow-md">
                    {item.label}
                  </span>
                </div>
              )
            })}
          </div>

          {onMinimize && (
            <div className="relative group pt-2 border-t border-[#EAEDF6]">
              <button
                type="button"
                onClick={onMinimize}
                aria-label="Minimize Window"
                className="h-10 w-10 rounded-2xl bg-[#F5F6FB]/90 text-[#5E647B] hover:bg-white hover:text-[#151722] flex items-center justify-center transition-all hover:scale-105"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
              <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute right-12 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full bg-[#15161C] text-white text-[11px] font-semibold whitespace-nowrap shadow-md">
                Minimize
              </span>
            </div>
          )}
        </nav>
      </div>

      {/* Add Participant Mid-Call Modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Additional Employees"
        subtitle="Filter by department or search by name / Employee ID (active employees only)"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={inviteSearch}
              onChange={(e) => setInviteSearch(e.target.value)}
              placeholder="Search name or EMP ID..."
              className="varta-input px-3 py-2 rounded-2xl text-xs"
            />
            <select
              value={inviteDeptFilter}
              onChange={(e) => setInviteDeptFilter(e.target.value)}
              className="varta-select px-3 py-2 rounded-2xl text-xs"
            >
              <option value="">All Departments</option>
              {Array.from(
                new Map(
                  uninvitedEmployees
                    .filter((e) => e.department?.name)
                    .map((e) => [e.department!.id, e.department!.name])
                ).entries()
              ).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-[#EEF0F7] rounded-2xl border border-[#E6E8F2]">
            {(() => {
              const q = inviteSearch.trim().toLowerCase()
              const matchingUninvited = uninvitedEmployees.filter((emp) => {
                if (isFoundingMember(emp)) return false
                if (inviteDeptFilter && emp.department_id !== inviteDeptFilter) return false
                if (q) {
                  const hay = `${emp.full_name} ${emp.employee_code} ${emp.designation} ${emp.department?.name ?? ''}`.toLowerCase()
                  if (!hay.includes(q)) return false
                }
                return true
              })
              if (matchingUninvited.length === 0) {
                return <p className="p-6 text-center text-xs text-[#8D92A8]">No matching uninvited active employees.</p>
              }
              return matchingUninvited.map((emp) => {
                const checked = inviteSelected.includes(emp.id)
                return (
                  <label key={emp.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[#F8F9FD]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setInviteSelected((prev) =>
                          prev.includes(emp.id) ? prev.filter((id) => id !== emp.id) : [...prev, emp.id]
                        )
                      }
                      className="rounded border-[#CFD4E6] text-[#4D4CEF]"
                    />
                    <Avatar name={emp.full_name} src={emp.avatar_url} size="xs" shape="circle" />
                    <div className="text-xs">
                      <p className="font-bold text-[#151722]">
                        {emp.full_name}{' '}
                        <span className="font-mono text-[#4D4CEF]">{getDisplayEmployeeId(emp) ?? 'Leadership'}</span>
                      </p>
                      <p className="text-[11px] text-[#7D839B]">
                        {emp.designation} • {emp.department?.name || 'VarTa'}
                      </p>
                    </div>
                  </label>
                )
              })
            })()}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setInviteOpen(false)} className="px-4 py-2 rounded-full bg-[#F1F3F9] text-xs font-semibold text-[#454A62]">
              Cancel
            </button>
            <button
              onClick={handleInviteMore}
              disabled={inviteSelected.length === 0}
              className="px-5 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-40 text-xs font-semibold text-white"
            >
              Invite Selected ({inviteSelected.length})
            </button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
