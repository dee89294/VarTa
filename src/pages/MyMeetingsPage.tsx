/**
 * File: src/pages/MyMeetingsPage.tsx
 * Purpose: Lists all meetings created by the signed-in user or sent to their email address,
 *   with organizer controls to copy/share links, send additional email invitations, host/join
 *   calls, or end/delete meetings.
 * Connected files:
 *   - `src/App.tsx` (route `/my-meetings`)
 *   - `supabase/functions/meeting-invitations/index.ts` (`get_share_link`, `send_invitations`)
 *   - `supabase/functions/get-livekit-token/index.ts` (`end_meeting`)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarClock,
  Copy,
  MailPlus,
  Plus,
  Search,
  Share2,
  Trash2,
  Video,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { formatDateTime } from '../lib/utils'
import { PageTransition } from '../components/ui/MotionPrimitives'
import { MeetingStatusBadge } from '../components/ui/StatusBadge'
import { Modal } from '../components/ui/Modal'
import type { Meeting, MeetingStatus } from '../types/database'

export function MyMeetingsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | MeetingStatus>('all')
  const [search, setSearch] = useState('')

  const [inviteModalMeeting, setInviteModalMeeting] = useState<Meeting | null>(null)
  const [extraEmailsInput, setExtraEmailsInput] = useState('')
  const [sendingInvites, setSendingInvites] = useState(false)

  const loadMeetings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select(
          `id, meeting_code, meeting_title, organizer_id, meeting_status, is_instant, waiting_room_enabled, scheduled_at, started_at, ended_at, created_at, updated_at,
           organizer:profiles!meetings_organizer_id_fkey(id, full_name, email),
           meeting_invitations(id, meeting_id, invitee_email, invitation_status, created_at, updated_at)`
        )
        .order('created_at', { ascending: false })
      if (error) throw error
      setMeetings((data ?? []) as unknown as Meeting[])
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed loading meetings',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadMeetings()
    const ch = supabase
      .channel('my-meetings-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => loadMeetings())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [loadMeetings])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return meetings.filter((m) => {
      if (statusFilter !== 'all' && m.meeting_status !== statusFilter) return false
      if (q) {
        const hay = `${m.meeting_title} ${m.meeting_code} ${m.organizer?.full_name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [meetings, statusFilter, search])

  const handleCopyShareLink = async (meeting: Meeting, openWhatsApp = false) => {
    try {
      const res = await invokeEdgeFunction<{ share_url: string }>('meeting-invitations', {
        action: 'get_share_link',
        meeting_id: meeting.id,
      })
      if (openWhatsApp) {
        const text = `Join "${meeting.meeting_title}" on VARTA:\n${res.share_url}`
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
        return
      }
      await navigator.clipboard.writeText(res.share_url)
      toast({ type: 'success', title: 'Secure Link Copied' })
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could Not Copy Link',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleEndMeeting = async (m: Meeting) => {
    if (!window.confirm(`End meeting "${m.meeting_title}" for all participants?`)) return
    try {
      await invokeEdgeFunction('get-livekit-token', {
        action: 'end_meeting',
        meeting_id: m.id,
      })
      toast({ type: 'success', title: 'Meeting Ended' })
      await loadMeetings()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed to end meeting',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleDeleteMeeting = async (m: Meeting) => {
    if (!window.confirm(`Delete meeting "${m.meeting_title}" permanently?`)) return
    try {
      const { error } = await supabase.from('meetings').delete().eq('id', m.id)
      if (error) throw error
      toast({ type: 'success', title: 'Meeting Deleted' })
      await loadMeetings()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleSendMoreInvites = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteModalMeeting) return
    const emails = extraEmailsInput
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))

    if (emails.length === 0) {
      toast({ type: 'warning', title: 'Enter valid email addresses' })
      return
    }

    setSendingInvites(true)
    try {
      const res = await invokeEdgeFunction<{
        invitation_results: Array<{ email: string; status: string; error?: string }>
      }>(
        'meeting-invitations',
        {
          action: 'send_invitations',
          meeting_id: inviteModalMeeting.id,
          invitee_emails: emails,
        }
      )
      const sent = (res.invitation_results ?? []).filter((r) => r.status === 'sent').length
      const firstErr = (res.invitation_results ?? []).find((r) => r.status !== 'sent' && r.error)?.error
      toast({
        type: sent < emails.length ? 'warning' : 'success',
        title: sent < emails.length ? 'Some Invitations Failed' : 'Invitations Sent',
        description:
          sent < emails.length && firstErr
            ? `Dispatched ${sent}/${emails.length} emails. ${firstErr}`
            : `Dispatched ${sent}/${emails.length} invitation email(s).`,
      })
      setInviteModalMeeting(null)
      setExtraEmailsInput('')
      await loadMeetings()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Invitation Error',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setSendingInvites(false)
    }
  }

  return (
    <PageTransition className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight">
            My Meetings
          </h1>
          <p className="text-sm text-[#6E748C] mt-1">
            Host meetings you created, send invites, or join meetings shared with your account.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/create-meeting')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-sm cursor-pointer self-start"
        >
          <Plus className="h-4 w-4 text-[#9C65E5]" />
          Create New Meeting
        </button>
      </div>

      {/* Filters */}
      <div className="varta-card rounded-[24px] p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'active', 'scheduled', 'ended', 'cancelled'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize transition-all cursor-pointer ${statusFilter === tab
                  ? 'bg-[#4D4CEF] text-white shadow-xs'
                  : 'bg-[#F4F5FA] text-[#5E647B] hover:text-[#151722]'
                }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="relative sm:w-64">
          <Search className="h-3.5 w-3.5 text-[#8D92A8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or code..."
            className="varta-input w-full pl-9 pr-3 py-2 rounded-full text-xs"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 rounded-[24px] bg-white border border-[#E7E9F4] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="varta-card rounded-[28px] p-10 text-center space-y-3">
          <p className="text-base font-bold text-[#151722]">No meetings found</p>
          <p className="text-xs text-[#6E748C]">Create a new meeting or adjust your status filter.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((m) => {
            const isOrganizer = m.organizer_id === user?.id
            const canEnter = m.meeting_status === 'active' || m.meeting_status === 'scheduled'
            return (
              <div key={m.id} className="varta-card rounded-[26px] p-5 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <MeetingStatusBadge status={m.meeting_status} />
                      <span className="font-mono text-[11px] font-semibold text-[#4D4CEF]">{m.meeting_code}</span>
                    </div>
                    {isOrganizer && (
                      <span className="px-2.5 py-0.5 rounded-full bg-[#15161C] text-white text-[10px] font-semibold">
                        Host
                      </span>
                    )}
                  </div>

                  <h2 className="font-display text-lg font-bold text-[#151722]">{m.meeting_title}</h2>

                  <div className="text-xs text-[#6E748C] space-y-1">
                    <p className="flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 text-[#4D4CEF]" />
                      {m.scheduled_at ? formatDateTime(m.scheduled_at) : 'Instant Meeting'}
                    </p>
                    {m.organizer?.full_name && <p>Organizer: {m.organizer.full_name}</p>}
                    {isOrganizer && (m.meeting_invitations?.length ?? 0) > 0 && (
                      <p>Invited emails: {m.meeting_invitations?.length}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#EEF0F7]">
                  {canEnter && (
                    <button
                      type="button"
                      onClick={() => navigate(`/meeting/${m.meeting_code}`)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white text-xs font-semibold cursor-pointer"
                    >
                      <Video className="h-3.5 w-3.5" />
                      {isOrganizer ? 'Host / Enter' : 'Join Meeting'}
                    </button>
                  )}

                  {isOrganizer && canEnter && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleCopyShareLink(m)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DCE0F0] text-xs font-semibold text-[#151722] cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5 text-[#4D4CEF]" />
                        Copy Link
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyShareLink(m, true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-emerald-50 border border-[#DCE0F0] text-xs font-semibold text-emerald-700 cursor-pointer"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        WhatsApp
                      </button>

                      <button
                        type="button"
                        onClick={() => setInviteModalMeeting(m)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DCE0F0] text-xs font-semibold text-[#151722] cursor-pointer"
                      >
                        <MailPlus className="h-3.5 w-3.5 text-[#9C65E5]" />
                        Invite
                      </button>

                      <button
                        type="button"
                        onClick={() => handleEndMeeting(m)}
                        className="inline-flex items-center gap-1 px-3.5 py-2 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-semibold text-rose-700 cursor-pointer"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        End
                      </button>
                    </>
                  )}

                  {isOrganizer && (m.meeting_status === 'ended' || m.meeting_status === 'cancelled') && (
                    <button
                      type="button"
                      onClick={() => handleDeleteMeeting(m)}
                      className="inline-flex items-center gap-1 px-3.5 py-2 rounded-full bg-white hover:bg-rose-50 border border-[#DCE0F0] text-xs font-semibold text-rose-700 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Invite Additional Emails Modal */}
      <Modal
        open={Boolean(inviteModalMeeting)}
        onClose={() => setInviteModalMeeting(null)}
        title={`Invite Participants — ${inviteModalMeeting?.meeting_title ?? ''}`}
      >
        <form onSubmit={handleSendMoreInvites} className="space-y-4">
          <p className="text-xs text-[#6E748C]">
            Enter one or more email addresses separated by commas or new lines. Each recipient will receive a secure
            VARTA join link.
          </p>
          <textarea
            rows={3}
            required
            value={extraEmailsInput}
            onChange={(e) => setExtraEmailsInput(e.target.value)}
            placeholder="guest1@example.com, teammate@example.com"
            className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-sm"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setInviteModalMeeting(null)}
              className="px-4 py-2 rounded-full bg-[#F4F5FA] text-xs font-semibold text-[#5E647B] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sendingInvites}
              className="px-5 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold text-white cursor-pointer"
            >
              {sendingInvites ? 'Sending...' : 'Send Invitations'}
            </button>
          </div>
        </form>
      </Modal>
    </PageTransition>
  )
}
