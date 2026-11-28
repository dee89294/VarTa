/**
 * File: src/components/meeting/LiveKitRoomView.tsx
 * Purpose: Real-time audio/video meeting room powered by official LiveKit Cloud SDK
 *   (`@livekit/components-react` + `livekit-client`). Supports live camera tiles, screen-share
 *   spotlight, participant names, mic/camera/screen controls, organizer admission/removal,
 *   leave meeting, and organizer-only end meeting.
 * Connected files:
 *   - `src/pages/MeetingRoomPage.tsx` (supplies LiveKit token, serverUrl, and lifecycle callbacks)
 *   - `supabase/functions/get-livekit-token/index.ts` (admit/remove/leave/end endpoints)
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VideoTrack,
  isTrackReference,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/components-react'
import { Track, type Participant } from 'livekit-client'
import '@livekit/components-styles'
import {
  Check,
  Copy,
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
import type { MeetingParticipant, ParticipantType } from '../../types/database'

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

function parseParticipantRole(p: Participant): ParticipantType {
  if (!p.metadata) return 'guest'
  try {
    const parsed = JSON.parse(p.metadata) as { participantType?: ParticipantType }
    return parsed.participantType ?? 'guest'
  } catch {
    return 'guest'
  }
}

function RoleTag({ type }: { type: ParticipantType }) {
  if (type === 'organizer') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-[#4D4CEF] text-white text-[10px] font-bold">
        Host
      </span>
    )
  }
  if (type === 'guest') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-[#9C65E5]/20 text-purple-100 text-[10px] font-semibold">
        Guest
      </span>
    )
  }
  return null
}

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

  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  }).filter(isTrackReference)

  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  })

  const [panelOpen, setPanelOpen] = useState(false)
  const [waitingQueue, setWaitingQueue] = useState<MeetingParticipant[]>([])
  const [dbParticipants, setDbParticipants] = useState<MeetingParticipant[]>([])
  const [copiedLink, setCopiedLink] = useState(false)
  const [ending, setEnding] = useState(false)
  const [busyControl, setBusyControl] = useState(false)

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

  const gridColsClass = useMemo(() => {
    const count = Math.max(1, cameraTracks.length)
    if (count === 1) return 'grid-cols-1 max-w-4xl mx-auto'
    if (count === 2) return 'grid-cols-1 md:grid-cols-2'
    if (count <= 4) return 'grid-cols-1 sm:grid-cols-2'
    return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  }, [cameraTracks.length])

  const activeScreenShare = screenTracks[0] ?? null

  return (
    <div className="h-[100dvh] w-full bg-[#10121A] text-white flex flex-col overflow-hidden">
      {/* Audio playback renderer for all remote tracks */}
      <RoomAudioRenderer />

      {/* Top Bar */}
      <header className="px-4 sm:px-6 py-3 bg-[#151824]/95 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center font-display font-extrabold text-sm shrink-0">
            V
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-sm sm:text-base font-bold truncate">{meetingTitle}</h1>
            <p className="text-[11px] font-mono text-indigo-300 truncate">{meetingCode}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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

      {/* Stage + Optional Participants Panel */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        <div className="flex-1 min-w-0 p-3 sm:p-5 overflow-y-auto flex flex-col gap-4">
          {/* Screen Share Spotlight */}
          {activeScreenShare && (
            <div className="relative rounded-3xl overflow-hidden bg-black border border-[#4D4CEF]/50 min-h-[260px] sm:min-h-[380px] flex-1">
              <VideoTrack trackRef={activeScreenShare} className="w-full h-full object-contain" />
              <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/75 backdrop-blur-md text-xs font-semibold border border-white/15">
                {activeScreenShare.participant.name || activeScreenShare.participant.identity} is sharing their screen
              </div>
            </div>
          )}

          {/* Camera Tiles Grid */}
          <div
            className={cn(
              'grid gap-3 w-full',
              activeScreenShare ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : cn('flex-1 items-stretch', gridColsClass)
            )}
          >
            {cameraTracks.map((trackRef) => {
              const p = trackRef.participant
              const displayName = p.name || p.identity
              const isLocal = p.isLocal
              const roleType = parseParticipantRole(p)
              const hasLiveVideo =
                isTrackReference(trackRef) && Boolean(trackRef.publication) && !trackRef.publication.isMuted

              return (
                <div
                  key={p.identity}
                  className={cn(
                    'relative rounded-2xl sm:rounded-3xl overflow-hidden bg-[#1A1E2E] border border-white/10 flex items-center justify-center',
                    activeScreenShare ? 'min-h-[130px]' : 'min-h-[200px] sm:min-h-[240px]'
                  )}
                >
                  {hasLiveVideo && isTrackReference(trackRef) ? (
                    <VideoTrack
                      trackRef={trackRef}
                      className={cn('w-full h-full object-cover', isLocal && 'scale-x-[-1]')}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 p-4">
                      <Avatar name={displayName} size="lg" shape="circle" className="ring-4 ring-white/10" />
                      <span className="text-[11px] text-white/60">Camera off</span>
                    </div>
                  )}

                  {/* Bottom Name & Mic Pill */}
                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/65 backdrop-blur-md border border-white/15 max-w-[80%]">
                      <span className="text-xs font-semibold text-white truncate">
                        {displayName}
                        {isLocal ? ' (You)' : ''}
                      </span>
                      <RoleTag type={roleType} />
                    </div>

                    <span
                      className={cn(
                        'h-7 w-7 rounded-full flex items-center justify-center shrink-0',
                        p.isMicrophoneEnabled ? 'bg-[#4D4CEF] text-white' : 'bg-rose-500 text-white'
                      )}
                    >
                      {p.isMicrophoneEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Participants Side Panel */}
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

              {/* Connected Participants List */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">In This Meeting</p>
                {participants.map((p) => {
                  const roleType = parseParticipantRole(p)
                  const dbRow = dbParticipants.find((row) => row.participant_identity === p.identity)
                  return (
                    <div
                      key={p.identity}
                      className="p-2.5 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-2"
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
                        {p.isMicrophoneEnabled ? (
                          <Mic className="h-3.5 w-3.5 text-indigo-300" />
                        ) : (
                          <MicOff className="h-3.5 w-3.5 text-rose-400" />
                        )}
                        {isOrganizer && !p.isLocal && dbRow && (
                          <button
                            type="button"
                            onClick={() => handleRemoveParticipant(dbRow.id)}
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

      {/* Bottom Controls Bar */}
      <footer className="px-4 py-3.5 bg-[#151824]/95 border-t border-white/10 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 shrink-0">
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
