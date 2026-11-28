/**
 * File: src/pages/CreateMeetingPage.tsx
 * Purpose: Authenticated organizer page for creating instant or scheduled meetings, generating
 *   secure invitation links, emailing multiple invitees automatically via `meeting-invitations`,
 *   copying links, and sharing via WhatsApp or native share.
 * Connected files:
 *   - `src/App.tsx` (route `/create-meeting`)
 *   - `supabase/functions/meeting-invitations/index.ts` (`create_meeting`)
 *   - `src/pages/MeetingRoomPage.tsx` (`/meeting/:code`)
 */
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  Mail,
  Plus,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import { invokeEdgeFunction } from '../lib/supabase'
import { formatDateTime } from '../lib/utils'
import { useToast } from '../contexts/ToastContext'
import { PageTransition } from '../components/ui/MotionPrimitives'
import type { Meeting } from '../types/database'

interface InvitationDelivery {
  email: string
  status: string
  error?: string
}

export function CreateMeetingPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [meetingTitle, setMeetingTitle] = useState('')
  const [isInstant, setIsInstant] = useState(true)
  const [waitingRoom, setWaitingRoom] = useState(false)
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [scheduledTime, setScheduledTime] = useState(() => {
    const d = new Date(Date.now() + 30 * 60_000)
    return `${String(d.getHours()).padStart(2, '0')}:${String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, '0')}`
  })

  const [emailInput, setEmailInput] = useState('')
  const [inviteEmails, setInviteEmails] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const [createdResult, setCreatedResult] = useState<{
    meeting: Meeting
    shareUrl: string
    deliveries: InvitationDelivery[]
  } | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  const addEmailsFromString = (raw: string) => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

    if (parts.length === 0) return

    const validToAdd: string[] = []
    const invalid: string[] = []
    for (const part of parts) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
        if (!inviteEmails.includes(part) && !validToAdd.includes(part)) {
          validToAdd.push(part)
        }
      } else {
        invalid.push(part)
      }
    }

    if (validToAdd.length > 0) {
      setInviteEmails((prev) => [...prev, ...validToAdd])
      setEmailInput('')
    }
    if (invalid.length > 0) {
      toast({
        type: 'warning',
        title: 'Invalid Email Skipped',
        description: `Check format for: ${invalid.join(', ')}`,
      })
    }
  }

  const removeEmail = (target: string) => {
    setInviteEmails((prev) => prev.filter((e) => e !== target))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Flush any typed but not-yet-submitted email in the input box
    let finalEmails = [...inviteEmails]
    if (emailInput.trim()) {
      const pendingParts = emailInput
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      for (const part of pendingParts) {
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
          if (!finalEmails.includes(part)) finalEmails.push(part)
        } else {
          toast({ type: 'error', title: 'Invalid Email Address', description: `Please fix "${part}" before sending.` })
          return
        }
      }
    }

    if (!meetingTitle.trim()) {
      toast({ type: 'warning', title: 'Meeting Title Required', description: 'Enter a clear title for your meeting.' })
      return
    }

    let scheduledAtIso: string | null = null
    if (!isInstant) {
      const d = new Date(`${scheduledDate}T${scheduledTime}:00`)
      if (Number.isNaN(d.getTime())) {
        toast({ type: 'error', title: 'Invalid Date or Time' })
        return
      }
      scheduledAtIso = d.toISOString()
    }

    setSubmitting(true)
    try {
      const res = await invokeEdgeFunction<{
        meeting: Meeting
        share_url: string
        invitation_results: InvitationDelivery[]
      }>('meeting-invitations', {
        action: 'create_meeting',
        meeting_title: meetingTitle.trim(),
        is_instant: isInstant,
        waiting_room_enabled: waitingRoom,
        scheduled_at: scheduledAtIso,
        invitee_emails: finalEmails,
      })

      setInviteEmails(finalEmails)
      setEmailInput('')
      setCreatedResult({
        meeting: res.meeting,
        shareUrl: res.share_url,
        deliveries: res.invitation_results ?? [],
      })

      const sentCount = (res.invitation_results ?? []).filter((r) => r.status === 'sent').length
      toast({
        type: 'success',
        title: 'Meeting Created',
        description:
          finalEmails.length > 0
            ? `Dispatched ${sentCount}/${finalEmails.length} email invitation(s).`
            : 'Secure meeting link is ready to copy or share.',
      })
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could Not Create Meeting',
        description: err instanceof Error ? err.message : 'Unexpected server error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyShareLink = async () => {
    if (!createdResult) return
    try {
      await navigator.clipboard.writeText(createdResult.shareUrl)
      setCopiedLink(true)
      toast({ type: 'success', title: 'Meeting Link Copied' })
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      toast({ type: 'error', title: 'Clipboard blocked', description: 'Copy the link manually below.' })
    }
  }

  const handleWhatsAppShare = () => {
    if (!createdResult) return
    const text = `You are invited to join "${createdResult.meeting.meeting_title}" on VARTA:\n${createdResult.shareUrl}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
  }

  const handleNativeShare = async () => {
    if (!createdResult) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: `VARTA Meeting: ${createdResult.meeting.meeting_title}`,
          text: `Join my VARTA video meeting: ${createdResult.meeting.meeting_title}`,
          url: createdResult.shareUrl,
        })
      } catch {
        // user cancelled share dialog
      }
    } else {
      await handleCopyShareLink()
    }
  }

  return (
    <PageTransition className="max-w-3xl mx-auto space-y-6">
      <div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#4D4CEF]/10 text-[#4D4CEF] text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5" />
          Host a New Meeting
        </span>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight mt-2">
          Create New Meeting
        </h1>
        <p className="text-sm text-[#6E748C] mt-1">
          Generate a private meeting link, invite guests or registered users via email, and start calling on LiveKit.
        </p>
      </div>

      {createdResult ? (
        <div className="varta-card rounded-[28px] p-6 sm:p-8 space-y-6">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-[#151722]">{createdResult.meeting.meeting_title}</h2>
              <p className="text-xs text-[#6E748C] mt-0.5">
                Meeting ID: <span className="font-mono font-bold text-[#4D4CEF]">{createdResult.meeting.meeting_code}</span>
                {createdResult.meeting.scheduled_at
                  ? ` • Scheduled for ${formatDateTime(createdResult.meeting.scheduled_at)}`
                  : ' • Ready Immediately'}
              </p>
            </div>
          </div>

          {/* Secure Link Box */}
          <div className="p-4 rounded-2xl bg-[#F6F7FB] border border-[#E5E8F2] space-y-3">
            <p className="text-xs font-bold text-[#151722]">Secure Invitation Link</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                readOnly
                value={createdResult.shareUrl}
                className="varta-input flex-1 px-3.5 py-2.5 rounded-2xl text-xs font-mono"
              />
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-white text-xs font-semibold shrink-0 cursor-pointer"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedLink ? 'Copied' : 'Copy Meeting Link'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={handleWhatsAppShare}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                Share on WhatsApp
              </button>
              <button
                type="button"
                onClick={handleNativeShare}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DCE0F0] text-[#151722] text-xs font-semibold cursor-pointer"
              >
                <Share2 className="h-3.5 w-3.5 text-[#4D4CEF]" />
                Share App Link
              </button>
            </div>
          </div>

          {/* Email Delivery Summary */}
          {createdResult.deliveries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-[#151722]">Email Invitations ({createdResult.deliveries.length})</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {createdResult.deliveries.map((d) => (
                  <div
                    key={d.email}
                    className="px-3.5 py-2.5 rounded-2xl bg-[#F8F9FD] border border-[#E7E9F4] flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate font-medium text-[#151722]">{d.email}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        d.status === 'sent'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {d.status === 'sent' ? 'Sent' : d.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#EEF0F7]">
            <button
              type="button"
              onClick={() => {
                setCreatedResult(null)
                setMeetingTitle('')
                setInviteEmails([])
              }}
              className="px-4 py-2.5 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DCE0F0] text-xs font-semibold text-[#5E647B] cursor-pointer"
            >
              Create Another Meeting
            </button>

            <button
              type="button"
              onClick={() => navigate(`/meeting/${createdResult.meeting.meeting_code}`)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white text-xs font-semibold shadow-sm cursor-pointer"
            >
              <Video className="h-4 w-4" />
              Enter Meeting Room
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="varta-card rounded-[28px] p-6 sm:p-8 space-y-6">
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Meeting Title</label>
            <input
              type="text"
              required
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              placeholder="e.g. Weekly Product Sync or Client Demo"
              className="varta-input w-full px-4 py-3 rounded-2xl text-sm"
            />
          </div>

          {/* Start Mode Toggle */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-[#454A62]">When does this meeting start?</label>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsInstant(true)}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                  isInstant
                    ? 'bg-[#4D4CEF]/8 border-[#4D4CEF] ring-2 ring-[#4D4CEF]/15'
                    : 'bg-[#F7F8FC] border-[#E5E8F2] hover:border-[#CFD4E6]'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[#151722]">
                  <Video className="h-4 w-4 text-[#4D4CEF]" />
                  Start Immediately
                </div>
                <p className="text-xs text-[#6E748C] mt-1">Room opens right away so invitees can join at once.</p>
              </button>

              <button
                type="button"
                onClick={() => setIsInstant(false)}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                  !isInstant
                    ? 'bg-[#4D4CEF]/8 border-[#4D4CEF] ring-2 ring-[#4D4CEF]/15'
                    : 'bg-[#F7F8FC] border-[#E5E8F2] hover:border-[#CFD4E6]'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[#151722]">
                  <CalendarClock className="h-4 w-4 text-[#9C65E5]" />
                  Schedule for Later
                </div>
                <p className="text-xs text-[#6E748C] mt-1">Pick a date and time included in email invitations.</p>
              </button>
            </div>

            {!isInstant && (
              <div className="grid sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Date</label>
                  <input
                    type="date"
                    required
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Start Time</label>
                  <input
                    type="time"
                    required
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Invitee Emails */}
          <div className="space-y-2.5">
            <label className="block text-xs font-semibold text-[#454A62]">
              Invite Participants by Email (Optional)
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addEmailsFromString(emailInput)
                    }
                  }}
                  placeholder="Enter one or more emails separated by comma or Enter"
                  className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => addEmailsFromString(emailInput)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DCE0F0] text-xs font-semibold text-[#151722] cursor-pointer shrink-0"
              >
                <Plus className="h-3.5 w-3.5 text-[#4D4CEF]" />
                Add
              </button>
            </div>

            {inviteEmails.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {inviteEmails.map((em) => (
                  <span
                    key={em}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EFF1F8] border border-[#DFE3F2] text-xs font-medium text-[#151722]"
                  >
                    {em}
                    <button
                      type="button"
                      onClick={() => removeEmail(em)}
                      className="text-[#7D839B] hover:text-rose-600 cursor-pointer"
                      aria-label={`Remove ${em}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center justify-between p-4 rounded-2xl bg-[#F7F8FC] border border-[#E5E8F2] cursor-pointer">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-[#4D4CEF] mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-[#151722]">Enable Waiting Room</p>
                <p className="text-[11px] text-[#6E748C]">Require host admission before guests/invitees enter video.</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={waitingRoom}
              onChange={(e) => setWaitingRoom(e.target.checked)}
              className="rounded border-[#CFD4E6] text-[#4D4CEF]"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 px-6 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_12px_26px_-8px_rgba(21,22,28,0.45)] transition-all cursor-pointer"
          >
            <Send className="h-4 w-4 text-[#9C65E5]" />
            {submitting ? 'Creating Meeting & Dispatching Invites...' : 'Send Invitation & Create Meeting'}
          </button>
        </form>
      )}
    </PageTransition>
  )
}
