/**
 * File: src/pages/DashboardPage.tsx
 * Purpose: Streamlined VARTA Meeting Dashboard displaying:
 *   - Welcome message with the authenticated user's name
 *   - Create New Meeting CTA
 *   - My Meetings preview & direct launch
 *   - Join Meeting form (link or ID)
 *   - Logout control
 * Connected files:
 *   - `src/App.tsx` (route `/dashboard`)
 *   - `src/contexts/AuthContext.tsx` (`profile`, `user`, `signOut()`)
 *   - `src/lib/supabase.ts` (`meetings` queries under RLS)
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CalendarClock,
  Link2,
  LogOut,
  Plus,
  Video,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDateTime, parseMeetingTarget } from '../lib/utils'
import { PageTransition } from '../components/ui/MotionPrimitives'
import { MeetingStatusBadge } from '../components/ui/StatusBadge'
import type { Meeting } from '../types/database'

export function DashboardPage() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [joinInput, setJoinInput] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  const displayName =
    profile?.full_name || String(user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'there')

  const loadMeetings = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabase
        .from('meetings')
        .select('id, meeting_code, meeting_title, organizer_id, meeting_status, is_instant, waiting_room_enabled, scheduled_at, started_at, ended_at, created_at, updated_at')
        .in('meeting_status', ['active', 'scheduled'])
        .order('created_at', { ascending: false })
        .limit(6)

      setMeetings((data ?? []) as Meeting[])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadMeetings()
  }, [loadMeetings])

  const handleJoinMeeting = (e: React.FormEvent) => {
    e.preventDefault()
    setJoinError(null)
    const target = parseMeetingTarget(joinInput)
    if (!target) {
      setJoinError('Paste a valid meeting link or enter a meeting ID.')
      return
    }
    navigate(target)
  }

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <PageTransition className="space-y-6">
      {/* Welcome Banner */}
      <section className="varta-card rounded-[28px] p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#4D4CEF]/10 text-[#4D4CEF] text-xs font-semibold">
            VARTA Meeting Workspace
          </span>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight">
            Welcome, {displayName}
          </h1>
          <p className="text-sm text-[#6E748C]">
            Start a new video meeting, share invitation links, or jump into your upcoming rooms.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/create-meeting"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-[0_12px_24px_-8px_rgba(21,22,28,0.45)] transition-all"
          >
            <Plus className="h-4 w-4 text-[#9C65E5]" />
            Create New Meeting
          </Link>
          <Link
            to="/my-meetings"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DCE0F0] text-xs font-semibold text-[#151722] transition-colors"
          >
            <Video className="h-4 w-4 text-[#4D4CEF]" />
            My Meetings
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-full bg-white hover:bg-rose-50 border border-[#DCE0F0] hover:border-rose-200 text-xs font-semibold text-[#5E647B] hover:text-rose-700 transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </section>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Join Meeting Card */}
        <section className="lg:col-span-5 varta-card rounded-[28px] p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold text-[#151722]">Join Meeting</h2>
            <p className="text-xs text-[#6E748C]">
              Paste a VARTA meeting invitation link or enter the meeting ID you received.
            </p>
          </div>

          <form onSubmit={handleJoinMeeting} className="space-y-3">
            <div className="relative">
              <Link2 className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={joinInput}
                onChange={(e) => {
                  setJoinInput(e.target.value)
                  setJoinError(null)
                }}
                placeholder="https://.../meeting/vrt-... or vrt-..."
                className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
              />
            </div>

            {joinError && <p className="text-xs font-medium text-rose-600">{joinError}</p>}

            <button
              type="submit"
              className="w-full py-2.5 px-5 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
            >
              Join Meeting
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </form>
        </section>

        {/* Active & Upcoming Meetings */}
        <section className="lg:col-span-7 varta-card rounded-[28px] p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-[#151722]">Your Upcoming & Live Meetings</h2>
              <p className="text-xs text-[#6E748C]">Meetings you organize or are invited to.</p>
            </div>
            <Link to="/my-meetings" className="text-xs font-semibold text-[#4D4CEF] hover:underline">
              View All →
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2.5">
              <div className="h-16 rounded-2xl bg-[#F4F5FA] animate-pulse" />
              <div className="h-16 rounded-2xl bg-[#F4F5FA] animate-pulse" />
            </div>
          ) : meetings.length === 0 ? (
            <div className="p-6 rounded-2xl bg-[#F6F7FB] border border-[#E7E9F4] text-center space-y-2">
              <p className="text-sm font-semibold text-[#151722]">No upcoming meetings yet</p>
              <p className="text-xs text-[#6E748C]">Create a new meeting to generate an invite link right away.</p>
              <Link
                to="/create-meeting"
                className="inline-flex items-center gap-1.5 mt-1 px-4 py-2 rounded-full bg-[#4D4CEF] text-white text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Meeting
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {meetings.map((m) => (
                <div
                  key={m.id}
                  className="p-4 rounded-2xl bg-[#F7F8FC] border border-[#E7E9F4] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <MeetingStatusBadge status={m.meeting_status} />
                      <span className="font-mono text-[11px] font-semibold text-[#4D4CEF]">{m.meeting_code}</span>
                    </div>
                    <p className="font-display text-sm font-bold text-[#151722] truncate">{m.meeting_title}</p>
                    <p className="text-xs text-[#6E748C] flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {m.scheduled_at ? formatDateTime(m.scheduled_at) : 'Instant Meeting'}
                    </p>
                  </div>

                  <Link
                    to={`/meeting/${m.meeting_code}`}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-white text-xs font-semibold shrink-0"
                  >
                    <Video className="h-3.5 w-3.5" />
                    {m.organizer_id === user?.id ? 'Host / Enter' : 'Join'}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageTransition>
  )
}
