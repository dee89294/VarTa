/**
 * File: src/components/meeting/FloatingMeetingPanels.tsx
 * Purpose: Floating glassmorphic side panels and compact toolbar popovers for the
 *   full-screen immersive LiveKit meeting interface (`LiveKitRoomView.tsx`).
 * Panels & Popovers:
 *   - `FloatingChatPanel`: Real-time Supabase + LiveKit DataChannel chat drawer.
 *   - `FloatingParticipantsPanel`: Live participant roster with role, mic, camera, and focus/remove actions.
 *   - `FloatingAddParticipantsPanel`: Shareable invite link copy, WhatsApp/native share, organizer email invites, and pending waiting-room approvals.
 *   - `LayoutPopover`: Compact Focus / Gallery / Screen Share mode switcher.
 *   - `MoreSettingsPopover`: Meeting details (title/ID/copy link), real audio/video device switching, and self-view mirror toggle.
 * Connected files:
 *   - `src/components/meeting/LiveKitRoomView.tsx`
 *   - `src/components/meeting/MeetingStageTiles.tsx` (`RoleTag`, `parseParticipantRole`)
 *   - `supabase/functions/meeting-invitations/index.ts` (`send_invitations`)
 */
import React, { useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import type { Participant } from 'livekit-client'
import {
  Camera,
  Check,
  Copy,
  FlipHorizontal2,
  LayoutGrid,
  Mail,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  Send,
  Share2,
  SlidersHorizontal,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
} from 'lucide-react'
import { invokeEdgeFunction } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'
import { Avatar } from '../ui/Avatar'
import { RoleTag, parseParticipantRole } from './MeetingStageTiles'
import type { MeetingParticipant } from '../../types/database'

export type MeetingViewMode = 'gallery' | 'focus' | 'screen_share'

export interface FloatingChatMessage {
  id: string
  sender_name: string
  sender_role: string
  message_text: string
  created_at: string
  participant_identity?: string
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

const QUICK_EMOJIS = ['👍', '👏', '😂', '🎉', '❤️', '🔥']

/**
 * Floating right-side Chat panel kept layered over the video stage without
 * unmounting or resizing the LiveKit session.
 */
export function FloatingChatPanel({
  messages,
  myIdentity,
  onSendMessage,
  onClose,
}: {
  messages: FloatingChatMessage[]
  myIdentity: string
  onSendMessage: (text: string) => Promise<void>
  onClose: () => void
}) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const submitMessage = async () => {
    const clean = input.trim()
    if (!clean || sending) return
    setSending(true)
    setInput('')
    try {
      await onSendMessage(clean)
    } catch {
      setInput(clean)
    } finally {
      setSending(false)
    }
  }

  return (
    <aside
      aria-label="Room chat"
      className="absolute top-3 bottom-24 right-3 sm:top-4 sm:right-4 sm:bottom-24 w-[calc(100%-1.5rem)] sm:w-[360px] z-30 rounded-3xl bg-[#0E111B]/88 backdrop-blur-2xl border border-white/12 shadow-[0_24px_60px_-14px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-white"
    >
      <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-display text-sm font-bold text-white">Room Chat</h2>
          <p className="text-[11px] text-white/50">Messages are visible to everyone in the call</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="h-8 w-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/75 hover:text-white cursor-pointer transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-xs text-white/45 mt-10">
            No messages yet. Start the conversation below.
          </div>
        )}
        {messages.map((msg) => {
          const isMe = Boolean(myIdentity) && msg.participant_identity === myIdentity
          return (
            <div key={msg.id} className={cn('flex gap-2', isMe && 'flex-row-reverse')}>
              <Avatar name={msg.sender_name} size="xs" shape="circle" className="shrink-0 mt-0.5" />
              <div className={cn('max-w-[80%]', isMe && 'items-end flex flex-col')}>
                <div className={cn('flex items-baseline gap-1.5 mb-0.5', isMe && 'flex-row-reverse')}>
                  <span className="text-[11px] font-semibold text-white/80">
                    {isMe ? 'You' : msg.sender_name}
                  </span>
                  <span className="text-[10px] text-white/40">{fmtTime(msg.created_at)}</span>
                </div>
                <div
                  className={cn(
                    'px-3 py-2 rounded-2xl text-xs leading-relaxed break-words',
                    isMe
                      ? 'bg-[#4D4CEF] text-white rounded-tr-sm'
                      : 'bg-white/10 text-white/95 rounded-tl-sm'
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

      <div className="px-3.5 pt-2 pb-3 border-t border-white/10 space-y-2 shrink-0 bg-black/20">
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setInput((prev) => `${prev}${emoji}`)}
              className="px-2 py-1 rounded-full bg-white/6 hover:bg-white/15 text-xs cursor-pointer transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitMessage()
              }
            }}
            placeholder="Send a message..."
            className="flex-1 px-3.5 py-2 rounded-full bg-white/8 border border-white/12 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-[#6163F6]"
          />
          <button
            type="button"
            onClick={submitMessage}
            disabled={!input.trim() || sending}
            aria-label="Send message"
            className="h-9 w-9 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] disabled:opacity-40 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          >
            <Send className="h-3.5 w-3.5 text-white" />
          </button>
        </div>
      </div>
    </aside>
  )
}

/**
 * Floating right-side Participants panel displaying connected participants,
 * Host/Guest roles, camera & mic statuses, click-to-focus, and Host removal.
 */
export function FloatingParticipantsPanel({
  participants,
  dbParticipants,
  screenSharingIdentities,
  isOrganizer,
  focusedIdentity,
  onSelectParticipant,
  onRemoveParticipant,
  onOpenAddPanel,
  onClose,
}: {
  participants: Participant[]
  dbParticipants: MeetingParticipant[]
  screenSharingIdentities: Set<string>
  isOrganizer: boolean
  focusedIdentity: string | null
  onSelectParticipant: (identity: string) => void
  onRemoveParticipant: (dbParticipantId: string) => void
  onOpenAddPanel: () => void
  onClose: () => void
}) {
  return (
    <aside
      aria-label="Participants"
      className="absolute top-3 bottom-24 right-3 sm:top-4 sm:right-4 sm:bottom-24 w-[calc(100%-1.5rem)] sm:w-[340px] z-30 rounded-3xl bg-[#0E111B]/88 backdrop-blur-2xl border border-white/12 shadow-[0_24px_60px_-14px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-white"
    >
      <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[#8183FF]" />
          <h2 className="font-display text-sm font-bold">Participants ({participants.length})</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenAddPanel}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#4D4CEF]/25 hover:bg-[#4D4CEF]/40 border border-[#6163F6]/40 text-[11px] font-semibold text-indigo-200 cursor-pointer transition-colors"
          >
            <UserPlus className="h-3 w-3" />
            Invite
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close participants"
            className="h-8 w-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/75 hover:text-white cursor-pointer transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {participants.map((p) => {
          const roleType = parseParticipantRole(p)
          const dbRow = dbParticipants.find((row) => row.participant_identity === p.identity)
          const isFocused = focusedIdentity === p.identity
          return (
            <div
              key={p.identity}
              onClick={() => onSelectParticipant(p.identity)}
              className={cn(
                'flex items-center justify-between gap-2 p-2.5 rounded-2xl border cursor-pointer transition-colors',
                isFocused
                  ? 'bg-[#4D4CEF]/22 border-[#6163F6]/60'
                  : 'bg-white/5 border-white/8 hover:bg-white/10'
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar name={p.name || p.identity} size="xs" shape="circle" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-white truncate">
                      {p.name || p.identity}
                      {p.isLocal ? ' (You)' : ''}
                    </span>
                    <RoleTag type={roleType} />
                  </div>
                  <p className="text-[10px] text-white/45 capitalize">
                    {p.isSpeaking ? 'Speaking now' : roleType === 'organizer' ? 'Organizer' : roleType}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {screenSharingIdentities.has(p.identity) && (
                  <span title="Sharing screen" className="text-indigo-300">
                    <MonitorUp className="h-3.5 w-3.5" />
                  </span>
                )}
                <span
                  title={p.isCameraEnabled ? 'Camera on' : 'Camera off'}
                  className={p.isCameraEnabled ? 'text-white/75' : 'text-rose-400/80'}
                >
                  {p.isCameraEnabled ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
                </span>
                <span
                  title={p.isMicrophoneEnabled ? 'Microphone on' : 'Microphone muted'}
                  className={p.isMicrophoneEnabled ? 'text-emerald-400' : 'text-rose-400'}
                >
                  {p.isMicrophoneEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                </span>
                {isOrganizer && !p.isLocal && dbRow && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveParticipant(dbRow.id)
                    }}
                    title="Remove participant"
                    className="p-1 rounded-full hover:bg-rose-500/20 text-white/50 hover:text-rose-300 cursor-pointer"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

/**
 * Floating Add Participants & Join Requests panel:
 * - Copy Meeting Link + WhatsApp / Native Share
 * - Organizer email invite form using existing `meeting-invitations` Edge Function
 * - Pending Waiting Room join requests with Accept / Reject controls
 */
export function FloatingAddParticipantsPanel({
  meetingId,
  meetingCode,
  meetingTitle,
  shareUrl,
  copiedLink,
  isOrganizer,
  waitingQueue,
  onCopyInvite,
  onAdmit,
  onReject,
  onClose,
}: {
  meetingId: string
  meetingCode: string
  meetingTitle: string
  shareUrl?: string | null
  copiedLink: boolean
  isOrganizer: boolean
  waitingQueue: MeetingParticipant[]
  onCopyInvite: () => void
  onAdmit: (participantId: string) => void
  onReject: (participantId: string) => void
  onClose: () => void
}) {
  const { toast } = useToast()
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)

  const resolvedShareUrl = shareUrl || `${window.location.origin}/meeting/${meetingCode}`

  const handleShareWhatsApp = () => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`Join "${meetingTitle}" on VARTA: ${resolvedShareUrl}`)}`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  const handleSendEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    const emails = inviteEmail
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))

    if (emails.length === 0) {
      toast({ type: 'warning', title: 'Enter a valid email address' })
      return
    }

    setSendingInvite(true)
    try {
      const res = await invokeEdgeFunction<{
        invitation_results?: { email: string; status: string; error?: string }[]
      }>('meeting-invitations', {
        action: 'send_invitations',
        meeting_id: meetingId,
        invitee_emails: emails,
      })

      const results = res.invitation_results ?? []
      const sentCount = results.filter((r) => r.status === 'sent').length
      const firstErr = results.find((r) => r.error)?.error

      setInviteEmail('')
      toast({
        type: sentCount > 0 ? 'success' : 'warning',
        title: sentCount > 0 ? 'Invitation Sent' : 'Invite Link Created',
        description:
          sentCount > 0
            ? `Sent invitation to ${sentCount}/${emails.length} recipient(s).`
            : firstErr || 'Email delivery is not configured — share the meeting link directly.',
      })
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could not send invite',
        description: err instanceof Error ? err.message : 'Unexpected error',
      })
    } finally {
      setSendingInvite(false)
    }
  }

  return (
    <aside
      aria-label="Add participants"
      className="absolute top-3 bottom-24 right-3 sm:top-4 sm:right-4 sm:bottom-24 w-[calc(100%-1.5rem)] sm:w-[360px] z-30 rounded-3xl bg-[#0E111B]/90 backdrop-blur-2xl border border-white/12 shadow-[0_24px_60px_-14px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-white"
    >
      <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold truncate">Add Participants</h2>
          <p className="text-[11px] text-white/50 truncate">
            {meetingTitle} • <span className="font-mono text-indigo-300">{meetingCode}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close add participants panel"
          className="h-8 w-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/75 hover:text-white cursor-pointer transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Shareable Joining Link */}
        <div className="p-3.5 rounded-2xl bg-white/6 border border-white/10 space-y-3">
          <div>
            <p className="text-xs font-bold text-white">Share Meeting Link</p>
            <p className="text-[11px] text-white/50 mt-0.5">
              Anyone with this link can join as a guest or log in.
            </p>
          </div>
          <div className="px-3 py-2 rounded-xl bg-black/35 border border-white/10 text-[11px] font-mono text-white/75 truncate select-all">
            {resolvedShareUrl}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCopyInvite}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white text-xs font-semibold cursor-pointer transition-colors"
            >
              {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedLink ? 'Copied Link' : 'Copy Link'}
            </button>
            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer transition-colors"
            >
              <Share2 className="h-3.5 w-3.5" />
              WhatsApp
            </button>
          </div>
        </div>

        {/* Organizer Waiting Room Requests */}
        {isOrganizer && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                Pending Join Requests
              </p>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 text-[10px] font-bold">
                {waitingQueue.length}
              </span>
            </div>

            {waitingQueue.length === 0 ? (
              <div className="p-3.5 rounded-2xl bg-white/4 border border-white/8 text-xs text-white/45 text-center">
                No participants waiting right now.
              </div>
            ) : (
              <div className="space-y-2">
                {waitingQueue.map((wp) => (
                  <div
                    key={wp.id}
                    className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-amber-500/12 border border-amber-400/30"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={wp.full_name} size="xs" shape="circle" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{wp.full_name}</p>
                        <p className="text-[10px] text-amber-200/75 capitalize">
                          {wp.email || wp.participant_type}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onReject(wp.id)}
                        title="Reject"
                        className="h-8 w-8 rounded-full bg-rose-500/20 hover:bg-rose-600 text-rose-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onAdmit(wp.id)}
                        title="Accept"
                        className="h-8 px-3 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Accept
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Organizer Email Invitations */}
        {isOrganizer && (
          <form onSubmit={handleSendEmailInvite} className="space-y-2.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-white/60">
              Invite via Email
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="h-3.5 w-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-9 pr-3 py-2.5 rounded-full bg-white/8 border border-white/12 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-[#6163F6]"
                />
              </div>
              <button
                type="submit"
                disabled={sendingInvite || !inviteEmail.trim()}
                className="px-4 py-2.5 rounded-full bg-white text-[#151722] hover:bg-indigo-50 disabled:opacity-45 text-xs font-bold cursor-pointer shrink-0 transition-colors"
              >
                {sendingInvite ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </aside>
  )
}

/**
 * Compact floating popover for switching between Focus View, Gallery View, and Screen Share View.
 */
export function LayoutPopover({
  viewMode,
  hasActiveScreenShare,
  onSelectMode,
  onClose,
}: {
  viewMode: MeetingViewMode
  hasActiveScreenShare: boolean
  onSelectMode: (mode: MeetingViewMode) => void
  onClose: () => void
}) {
  const options: {
    mode: MeetingViewMode
    label: string
    description: string
    icon: React.ReactNode
    disabled?: boolean
  }[] = [
    {
      mode: 'focus',
      label: 'Focus View',
      description: 'Selected speaker fills the screen',
      icon: <Maximize2 className="h-4 w-4" />,
    },
    {
      mode: 'gallery',
      label: 'Gallery View',
      description: 'Responsive grid of all participants',
      icon: <LayoutGrid className="h-4 w-4" />,
    },
    {
      mode: 'screen_share',
      label: 'Screen Share View',
      description: hasActiveScreenShare
        ? 'Shared screen fills main area'
        : 'Available when a screen is shared',
      icon: <MonitorUp className="h-4 w-4" />,
      disabled: !hasActiveScreenShare,
    },
  ]

  return (
    <div
      role="dialog"
      aria-label="Meeting layout options"
      className="w-64 rounded-2xl bg-[#10131F]/92 backdrop-blur-2xl border border-white/14 p-2 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.9)] text-white"
    >
      <div className="px-2.5 py-1.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/55">
          Change Layout
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-full text-white/50 hover:text-white cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-1 mt-1">
        {options.map((opt) => {
          const active = viewMode === opt.mode
          return (
            <button
              key={opt.mode}
              type="button"
              disabled={opt.disabled}
              onClick={() => {
                onSelectMode(opt.mode)
                onClose()
              }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
                opt.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'cursor-pointer hover:bg-white/10',
                active && 'bg-[#4D4CEF]/25 border border-[#6163F6]/50'
              )}
            >
              <span className={cn('shrink-0', active ? 'text-[#8183FF]' : 'text-white/70')}>
                {opt.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white">{opt.label}</p>
                <p className="text-[10px] text-white/50 truncate">{opt.description}</p>
              </div>
              {active && <Check className="h-3.5 w-3.5 text-[#8183FF] shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Compact floating More Settings popover:
 * - Displays Meeting Title & Meeting ID (`meetingCode`) + Copy Link (moved out of top header)
 * - Switches active Audio Input / Video Input / Audio Output devices via LiveKit `room.switchActiveDevice`
 * - Toggles local camera mirroring
 */
export function MoreSettingsPopover({
  meetingTitle,
  meetingCode,
  organizerName,
  copiedLink,
  mirrorLocal,
  onToggleMirror,
  onCopyInvite,
  onClose,
}: {
  meetingTitle: string
  meetingCode: string
  organizerName?: string
  copiedLink: boolean
  mirrorLocal: boolean
  onToggleMirror: () => void
  onCopyInvite: () => void
  onClose: () => void
}) {
  const room = useRoomContext()
  const { toast } = useToast()
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cams, setCams] = useState<MediaDeviceInfo[]>([])
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([])
  const [activeMic, setActiveMic] = useState('')
  const [activeCam, setActiveCam] = useState('')
  const [activeSpeaker, setActiveSpeaker] = useState('')

  useEffect(() => {
    let mounted = true
    const loadDevices = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!mounted) return
        setMics(devices.filter((d) => d.kind === 'audioinput'))
        setCams(devices.filter((d) => d.kind === 'videoinput'))
        setSpeakers(devices.filter((d) => d.kind === 'audiooutput'))
        setActiveMic(room.getActiveDevice('audioinput') ?? '')
        setActiveCam(room.getActiveDevice('videoinput') ?? '')
        setActiveSpeaker(room.getActiveDevice('audiooutput') ?? '')
      } catch {
        // ignore device enumeration errors
      }
    }
    loadDevices()
    return () => {
      mounted = false
    }
  }, [room])

  const switchDevice = async (kind: 'audioinput' | 'videoinput' | 'audiooutput', deviceId: string) => {
    try {
      await room.switchActiveDevice(kind, deviceId)
      if (kind === 'audioinput') setActiveMic(deviceId)
      if (kind === 'videoinput') setActiveCam(deviceId)
      if (kind === 'audiooutput') setActiveSpeaker(deviceId)
      toast({ type: 'success', title: 'Device Updated' })
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could not switch device',
        description: err instanceof Error ? err.message : 'Device unavailable',
      })
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Meeting settings and details"
      className="w-72 sm:w-80 rounded-2xl bg-[#10131F]/92 backdrop-blur-2xl border border-white/14 p-3.5 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.9)] text-white space-y-3.5"
    >
      {/* Meeting Info Header */}
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-white/10">
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">{meetingTitle}</p>
          <p className="text-[11px] font-mono text-indigo-300 mt-0.5">{meetingCode}</p>
          {organizerName && (
            <p className="text-[10px] text-white/45 mt-0.5">Host: {organizerName}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-full text-white/50 hover:text-white cursor-pointer shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Quick Copy Link */}
      <button
        type="button"
        onClick={onCopyInvite}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-white/10 hover:bg-white/16 text-xs font-semibold text-white cursor-pointer transition-colors"
      >
        {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        {copiedLink ? 'Meeting Link Copied' : 'Copy Meeting Link'}
      </button>

      {/* Media Devices */}
      <div className="space-y-2.5 pt-1 border-t border-white/10">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/55">
          <SlidersHorizontal className="h-3 w-3" />
          Audio &amp; Video Settings
        </div>

        {mics.length > 0 && (
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] text-white/70">
              <Mic className="h-3 w-3 text-indigo-300" /> Microphone
            </span>
            <select
              value={activeMic}
              onChange={(e) => switchDevice('audioinput', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl bg-white/8 border border-white/12 text-[11px] text-white focus:outline-none focus:border-[#6163F6]"
            >
              {mics.map((m, idx) => (
                <option key={m.deviceId || idx} value={m.deviceId} className="bg-[#10131F] text-white">
                  {m.label || `Microphone ${idx + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        {cams.length > 0 && (
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] text-white/70">
              <Camera className="h-3 w-3 text-indigo-300" /> Camera
            </span>
            <select
              value={activeCam}
              onChange={(e) => switchDevice('videoinput', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl bg-white/8 border border-white/12 text-[11px] text-white focus:outline-none focus:border-[#6163F6]"
            >
              {cams.map((c, idx) => (
                <option key={c.deviceId || idx} value={c.deviceId} className="bg-[#10131F] text-white">
                  {c.label || `Camera ${idx + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        {speakers.length > 0 && (
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] text-white/70">
              <Volume2 className="h-3 w-3 text-indigo-300" /> Speaker
            </span>
            <select
              value={activeSpeaker}
              onChange={(e) => switchDevice('audiooutput', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl bg-white/8 border border-white/12 text-[11px] text-white focus:outline-none focus:border-[#6163F6]"
            >
              {speakers.map((s, idx) => (
                <option key={s.deviceId || idx} value={s.deviceId} className="bg-[#10131F] text-white">
                  {s.label || `Speaker ${idx + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={onToggleMirror}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/6 hover:bg-white/10 text-xs text-white/85 cursor-pointer transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <FlipHorizontal2 className="h-3.5 w-3.5 text-indigo-300" />
            Mirror Self-View
          </span>
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-bold',
              mirrorLocal ? 'bg-[#4D4CEF] text-white' : 'bg-white/10 text-white/60'
            )}
          >
            {mirrorLocal ? 'On' : 'Off'}
          </span>
        </button>
      </div>
    </div>
  )
}
