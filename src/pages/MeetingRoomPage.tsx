/**
 * File: src/pages/MeetingRoomPage.tsx
 * Purpose: Meeting invitation entry gate, Guest Joining screen, Login/Sign Up redirect preservation,
 *   Waiting Room polling, and active LiveKit Cloud video room host (`/meeting/:id`).
 * Workflows supported:
 *   1. Guest Joining: Enter Full Name (required) + Email (optional) -> Join Meeting directly without account.
 *   2. Login / Sign Up: Links to `/login?redirect=...` and `/register?redirect=...` preserving original meeting URL.
 *   3. Authenticated User / Organizer: Auto-identifies profile and issues server-signed LiveKit token.
 * Connected files:
 *   - `src/App.tsx` (routes `/meeting/:id`, `/meetings/:id`)
 *   - `supabase/functions/get-livekit-token/index.ts` (`preview`, `join_token`, `leave`, `end_meeting`)
 *   - `src/components/meeting/LiveKitRoomView.tsx`
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Link2,
  LogIn,
  Mail,
  Mic,
  MicOff,
  ShieldAlert,
  User,
  UserPlus,
  Video,
  VideoOff,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { invokeEdgeFunction } from '../lib/supabase'
import { formatDateTime, parseMeetingTarget } from '../lib/utils'
import { LiveKitRoomView } from '../components/meeting/LiveKitRoomView'

interface PreviewMeeting {
  id: string
  meeting_code: string
  meeting_title: string
  meeting_status: 'scheduled' | 'active' | 'ended' | 'cancelled'
  waiting_room_enabled: boolean
  scheduled_at: string | null
  organizer_name: string
}

interface JoinTokenResponse {
  status: 'admitted' | 'waiting_room'
  reason?: string
  token?: string
  server_url?: string
  room_name?: string
  participant_id: string
  participant_identity: string
  participant_type: 'organizer' | 'registered' | 'guest'
  is_organizer: boolean
  meeting: PreviewMeeting
}

export function MeetingRoomPage() {
  const { id: meetingIdentifier = '' } = useParams()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile, loading: authLoading } = useAuth()
  const { toast } = useToast()

  const inviteToken = searchParams.get('token') ?? ''
  const shareToken = searchParams.get('invite') ?? ''
  const currentMeetingUrlWithTokens = `${location.pathname}${location.search}`

  const [stage, setStage] = useState<'checking' | 'denied' | 'lobby' | 'waiting_room' | 'in_call' | 'ended'>('checking')
  const [denyReason, setDenyReason] = useState('')
  const [meeting, setMeeting] = useState<PreviewMeeting | null>(null)
  const [isOrganizer, setIsOrganizer] = useState(false)

  // Guest / Pre-join state
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [preMicOn, setPreMicOn] = useState(true)
  const [preCamOn, setPreCamOn] = useState(true)
  const [joining, setJoining] = useState(false)
  const [pasteLinkInput, setPasteLinkInput] = useState('')

  // Active LiveKit / Waiting state
  const [livekitToken, setLivekitToken] = useState('')
  const [livekitUrl, setLivekitUrl] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [participantIdentity, setParticipantIdentity] = useState('')
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  const checkAccess = useCallback(async () => {
    if (!meetingIdentifier) {
      setDenyReason('Missing meeting ID.')
      setStage('denied')
      return
    }
    setStage((prev) => (prev === 'in_call' ? 'in_call' : 'checking'))
    try {
      const res = await invokeEdgeFunction<{
        authorized: boolean
        is_organizer: boolean
        meeting: PreviewMeeting
      }>(
        'get-livekit-token',
        {
          action: 'preview',
          meeting_id: meetingIdentifier,
          invite_token: inviteToken,
          share_token: shareToken,
        },
        false
      )
      setMeeting(res.meeting)
      setIsOrganizer(res.is_organizer)

      if (res.meeting.meeting_status === 'ended' || res.meeting.meeting_status === 'cancelled') {
        setStage('ended')
      } else {
        setStage((prev) => (prev === 'in_call' ? 'in_call' : 'lobby'))
      }
    } catch (err) {
      setDenyReason(err instanceof Error ? err.message : 'Unable to access this meeting.')
      setStage('denied')
    }
  }, [meetingIdentifier, inviteToken, shareToken])

  useEffect(() => {
    if (!authLoading) {
      checkAccess()
    }
  }, [authLoading, checkAccess])

  // Load organizer share URL cleanly if organizer enters lobby
  useEffect(() => {
    if (isOrganizer && meeting?.id && !shareToken) {
      invokeEdgeFunction<{ share_url: string }>('meeting-invitations', {
        action: 'get_share_link',
        meeting_id: meeting.id,
      })
        .then((res) => setShareUrl(res.share_url))
        .catch(() => {})
    } else if (shareToken && meeting?.meeting_code) {
      setShareUrl(`${window.location.origin}/meeting/${meeting.meeting_code}?invite=${encodeURIComponent(shareToken)}`)
    }
  }, [isOrganizer, meeting?.id, meeting?.meeting_code, shareToken])

  const requestJoinToken = useCallback(
    async (explicitIdentity?: string) => {
      const res = await invokeEdgeFunction<JoinTokenResponse>(
        'get-livekit-token',
        {
          action: 'join_token',
          meeting_id: meetingIdentifier,
          invite_token: inviteToken,
          share_token: shareToken,
          full_name: user ? profile?.full_name : guestName.trim(),
          email: user ? profile?.email : guestEmail.trim().toLowerCase() || undefined,
          participant_identity: explicitIdentity || participantIdentity || undefined,
        },
        false
      )

      setMeeting(res.meeting)
      setIsOrganizer(res.is_organizer)
      setParticipantId(res.participant_id)
      setParticipantIdentity(res.participant_identity)

      if (res.status === 'waiting_room') {
        setStage('waiting_room')
        return
      }

      if (!res.token || !res.server_url) {
        throw new Error('LiveKit session token missing in server response.')
      }

      setLivekitToken(res.token)
      setLivekitUrl(res.server_url)
      setStage('in_call')
    },
    [meetingIdentifier, inviteToken, shareToken, user, profile, guestName, guestEmail, participantIdentity]
  )

  // Poll while in waiting room until admitted or meeting becomes active
  useEffect(() => {
    if (stage !== 'waiting_room') return
    const timer = window.setInterval(() => {
      requestJoinToken(participantIdentity).catch((err) => {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('removed') || msg.includes('ended')) {
          setDenyReason(msg)
          setStage('denied')
        }
      })
    }, 3500)
    return () => window.clearInterval(timer)
  }, [stage, participantIdentity, requestJoinToken])

  const handleJoinSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!user && !guestName.trim()) {
      toast({ type: 'warning', title: 'Full Name Required', description: 'Please enter your full name to join as a guest.' })
      return
    }

    setJoining(true)
    try {
      await requestJoinToken()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could Not Join Meeting',
        description: err instanceof Error ? err.message : 'Check invitation details or try again.',
      })
    } finally {
      setJoining(false)
    }
  }

  const handleLeave = useCallback(async () => {
    if (meeting?.id && (participantId || participantIdentity)) {
      invokeEdgeFunction(
        'get-livekit-token',
        {
          action: 'leave',
          meeting_id: meeting.id,
          invite_token: inviteToken,
          share_token: shareToken,
          participant_id: participantId,
          participant_identity: participantIdentity,
        },
        false
      ).catch(() => {})
    }
    setLivekitToken('')
    navigate(user ? '/dashboard' : '/', { replace: true })
  }, [meeting?.id, participantId, participantIdentity, inviteToken, shareToken, navigate, user])

  const handleEndMeeting = useCallback(async () => {
    if (!meeting?.id) return
    await invokeEdgeFunction('get-livekit-token', {
      action: 'end_meeting',
      meeting_id: meeting.id,
    })
    setLivekitToken('')
    setStage('ended')
    toast({ type: 'success', title: 'Meeting Ended for Everyone' })
  }, [meeting?.id, toast])

  if (stage === 'in_call' && livekitToken && livekitUrl && meeting) {
    return (
      <LiveKitRoomView
        serverUrl={livekitUrl}
        token={livekitToken}
        meetingId={meeting.id}
        meetingCode={meeting.meeting_code}
        meetingTitle={meeting.meeting_title}
        shareUrl={shareUrl}
        isOrganizer={isOrganizer}
        initialAudio={preMicOn}
        initialVideo={preCamOn}
        onLeave={handleLeave}
        onEndMeeting={handleEndMeeting}
        onDisconnectedByServer={() => {
          setLivekitToken('')
          setStage((prev) => (prev === 'ended' ? 'ended' : 'ended'))
        }}
      />
    )
  }

  const loginUrl = `/login?redirect=${encodeURIComponent(currentMeetingUrlWithTokens)}`
  const signupUrl = `/register?redirect=${encodeURIComponent(currentMeetingUrlWithTokens)}`

  return (
    <div className="min-h-screen varta-canvas flex flex-col">
      <header className="max-w-5xl w-full mx-auto px-4 sm:px-8 py-5 flex items-center justify-between">
        <Link to={user ? '/dashboard' : '/'} className="inline-flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center text-white font-display font-extrabold">
            V
          </div>
          <span className="font-display text-lg font-bold text-[#151722]">VarTa</span>
        </Link>
        {user ? (
          <Link to="/dashboard" className="text-xs font-semibold text-[#4D4CEF] hover:underline">
            Back to Dashboard →
          </Link>
        ) : (
          <Link to="/" className="text-xs font-semibold text-[#6E748C] hover:text-[#151722]">
            Back Home
          </Link>
        )}
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-8 py-6 flex items-center justify-center">
        {stage === 'checking' && (
          <div className="varta-card rounded-[28px] p-10 text-center space-y-3 max-w-md w-full">
            <div className="h-10 w-10 rounded-full border-2 border-[#4D4CEF] border-t-transparent animate-spin mx-auto" />
            <p className="text-sm font-semibold text-[#151722]">Verifying meeting invitation...</p>
          </div>
        )}

        {stage === 'denied' && (
          <div className="varta-card rounded-[28px] p-8 space-y-5 max-w-lg w-full">
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold text-[#151722]">Invitation Required</h1>
                <p className="text-xs text-[#6E748C] mt-1 leading-relaxed">{denyReason}</p>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                const target = parseMeetingTarget(pasteLinkInput)
                if (target) navigate(target)
              }}
              className="space-y-2.5 pt-2 border-t border-[#EEF0F7]"
            >
              <label className="block text-xs font-semibold text-[#454A62]">
                Have the full invitation link? Paste it here:
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={pasteLinkInput}
                    onChange={(e) => setPasteLinkInput(e.target.value)}
                    placeholder="https://varta-phi.vercel.app/meeting/..."
                    className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-full bg-[#4D4CEF] text-white text-xs font-semibold cursor-pointer"
                >
                  Open Link
                </button>
              </div>
            </form>

            {!user && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Link
                  to={loginUrl}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#15161C] text-white text-xs font-semibold"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Login
                </Link>
                <Link
                  to={signupUrl}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white border border-[#DCE0F0] text-[#151722] text-xs font-semibold"
                >
                  <UserPlus className="h-3.5 w-3.5 text-[#4D4CEF]" />
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        )}

        {stage === 'ended' && (
          <div className="varta-card rounded-[28px] p-8 sm:p-10 text-center space-y-4 max-w-md w-full">
            <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h1 className="font-display text-2xl font-bold text-[#151722]">Meeting Ended</h1>
            <p className="text-xs text-[#6E748C]">
              {meeting?.meeting_title ? `"${meeting.meeting_title}" has ended.` : 'This video call has ended.'}
            </p>
            <Link
              to={user ? '/dashboard' : '/'}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#15161C] text-white text-xs font-semibold"
            >
              {user ? 'Return to Dashboard' : 'Back Home'}
            </Link>
          </div>
        )}

        {stage === 'waiting_room' && meeting && (
          <div className="varta-card rounded-[28px] p-8 sm:p-10 text-center space-y-4 max-w-md w-full">
            <div className="h-12 w-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto animate-pulse">
              <Clock className="h-6 w-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-[#151722]">{meeting.meeting_title}</h1>
            <p className="text-xs text-[#6E748C] leading-relaxed">
              {meeting.meeting_status === 'scheduled'
                ? `Waiting for ${meeting.organizer_name} to start this meeting. You will join automatically once the host enters.`
                : `Waiting for ${meeting.organizer_name} to admit you from the waiting room...`}
            </p>
            <button
              type="button"
              onClick={() => navigate(user ? '/dashboard' : '/')}
              className="px-4 py-2 rounded-full bg-[#F4F5FA] text-xs font-semibold text-[#5E647B] cursor-pointer"
            >
              Cancel & Leave
            </button>
          </div>
        )}

        {stage === 'lobby' && meeting && (
          <div className="w-full space-y-5">
            {/* Meeting Greeting Header */}
            <div className="varta-card rounded-[28px] p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#4D4CEF]/10 text-[#4D4CEF] text-xs font-semibold font-mono">
                  {meeting.meeting_code}
                </span>
                <h1 className="font-display text-2xl font-bold text-[#151722]">{meeting.meeting_title}</h1>
                <p className="text-xs text-[#6E748C] flex flex-wrap items-center gap-2">
                  <span>Hosted by <strong>{meeting.organizer_name}</strong></span>
                  {meeting.scheduled_at && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {formatDateTime(meeting.scheduled_at)}
                    </span>
                  )}
                </p>
              </div>

              {/* Pre-Join Audio/Video Toggles */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreMicOn((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold border cursor-pointer ${
                    preMicOn
                      ? 'bg-white border-[#DCE0F0] text-[#151722]'
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                  }`}
                >
                  {preMicOn ? <Mic className="h-3.5 w-3.5 text-[#4D4CEF]" /> : <MicOff className="h-3.5 w-3.5" />}
                  {preMicOn ? 'Mic On' : 'Mic Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setPreCamOn((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold border cursor-pointer ${
                    preCamOn
                      ? 'bg-white border-[#DCE0F0] text-[#151722]'
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                  }`}
                >
                  {preCamOn ? <Video className="h-3.5 w-3.5 text-[#4D4CEF]" /> : <VideoOff className="h-3.5 w-3.5" />}
                  {preCamOn ? 'Cam On' : 'Cam Off'}
                </button>
              </div>
            </div>

            {/* Authenticated vs Guest Entry Options */}
            {user ? (
              <div className="varta-card rounded-[28px] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                    {isOrganizer ? 'Meeting Host' : 'Signed-In Participant'}
                  </span>
                  <p className="font-display text-lg font-bold text-[#151722] mt-1">
                    {profile?.full_name || user.email}
                  </p>
                  <p className="text-xs text-[#6E748C]">{user.email}</p>
                </div>

                <button
                  type="button"
                  disabled={joining}
                  onClick={() => handleJoinSubmit()}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white text-sm font-semibold shadow-sm cursor-pointer"
                >
                  <Video className="h-4 w-4 text-[#9C65E5]" />
                  {joining ? 'Connecting to LiveKit...' : isOrganizer ? 'Host & Enter Meeting' : 'Join Meeting'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="grid md:grid-cols-12 gap-5">
                {/* Option 1: Join as Guest */}
                <form onSubmit={handleJoinSubmit} className="md:col-span-7 varta-card rounded-[28px] p-6 sm:p-7 space-y-4">
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#9C65E5]/12 text-[#773DC8] text-[11px] font-bold">
                      Option 1 — No Account Required
                    </span>
                    <h2 className="font-display text-xl font-bold text-[#151722] mt-2">Join as Guest</h2>
                    <p className="text-xs text-[#6E748C] mt-0.5">
                      Enter your full name to join the video meeting immediately.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Full Name *</label>
                    <div className="relative">
                      <User className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Enter your full name"
                        className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Email Address (Optional)</label>
                    <div className="relative">
                      <Mail className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={guestEmail}
                        onChange={(e) => setGuestEmail(e.target.value)}
                        placeholder="you@example.com (optional)"
                        className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={joining}
                    className="w-full py-3 px-5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    <Video className="h-4 w-4 text-[#9C65E5]" />
                    {joining ? 'Joining Room...' : 'Join as Guest'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>

                {/* Option 2: Login / Sign Up */}
                <div className="md:col-span-5 varta-card rounded-[28px] p-6 sm:p-7 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#4D4CEF]/10 text-[#4D4CEF] text-[11px] font-bold">
                      Option 2 — VARTA Account
                    </span>
                    <h2 className="font-display text-xl font-bold text-[#151722]">Login or Sign Up</h2>
                    <p className="text-xs text-[#6E748C] leading-relaxed">
                      Have a VARTA account or want to create one? You&apos;ll be returned directly to this meeting
                      immediately after signing in.
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <Link
                      to={loginUrl}
                      className="w-full py-3 px-5 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
                    >
                      <LogIn className="h-4 w-4" />
                      Login &amp; Join Meeting
                    </Link>
                    <Link
                      to={signupUrl}
                      className="w-full py-3 px-5 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DCE0F0] text-[#151722] text-xs font-semibold inline-flex items-center justify-center gap-2"
                    >
                      <UserPlus className="h-4 w-4 text-[#4D4CEF]" />
                      Sign Up &amp; Join Meeting
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
