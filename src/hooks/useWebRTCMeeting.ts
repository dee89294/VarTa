/**
 * File: src/hooks/useWebRTCMeeting.ts
 * Purpose: Manages real peer-to-peer WebRTC audio/video/screen-share streams (`RTCPeerConnection`),
 *   device switching, Web Audio active-speaker detection, and Supabase Realtime signaling.
 * Why required: Powers genuine live video/audio conferencing inside `LiveMeetingPage.tsx` without external
 *   paid video SDKs by relaying SDP offers/answers and ICE candidates over an authorized Realtime channel.
 * Connected files:
 *   - `src/pages/LiveMeetingPage.tsx` (consumes `localStream`, `remotePeers`, `activeSpeakerPeerId`, and controls)
 *   - `src/lib/supabase.ts` (connects to private Realtime channel `meeting:<id>:rtc`)
 *   - `supabase/migrations/20261126000001_initial_varta_schema.sql` (`realtime.messages` RLS + `private.can_access_realtime_topic`)
 * Data flow:
 *   1. Once `joinedRoom` is true, requests local camera/mic via `navigator.mediaDevices.getUserMedia`
 *      (gracefully falling back to audio-only or receive-only if hardware is unavailable/busy).
 *   2. Subscribes to private Supabase Realtime channel `meeting:<meetingId>:rtc` using Presence to discover peers.
 *   3. Runs WebRTC Perfect Negotiation (`myPeerId < remotePeerId` polite tie-breaker) over Realtime Broadcast (`rtc-signal`).
 *   4. Samples local & remote audio levels via `AudioContext` `AnalyserNode` to highlight the active speaker.
 *   5. Organizer commands (`mute` / `remove`) broadcast on `organizer-control` are enforced on the target client.
 * Impact if modified/removed: Live video/audio calls, screen sharing, active speaker detection, and remote mute stop working.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types/database'

export interface RemotePeerState {
  peerId: string
  employeeId: string
  employeeCode: string
  fullName: string
  designation: string
  avatarUrl: string | null
  micOn: boolean
  camOn: boolean
  screenSharing: boolean
  handRaised: boolean
  stream: MediaStream | null
}

interface UseWebRTCMeetingArgs {
  meetingId: string
  employee: Employee | null
  joinedRoom: boolean
  initialMicOn: boolean
  initialCamOn: boolean
  onForcedMute?: () => void
  onRemoved?: () => void
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export function useWebRTCMeeting({
  meetingId,
  employee,
  joinedRoom,
  initialMicOn,
  initialCamOn,
  onForcedMute,
  onRemoved,
}: UseWebRTCMeetingArgs) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(initialMicOn)
  const [camOn, setCamOn] = useState(initialCamOn)
  const [screenSharing, setScreenSharing] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [mediaNotice, setMediaNotice] = useState<string | null>(null)
  const [devices, setDevices] = useState<{ audioInputs: MediaDeviceInfo[]; videoInputs: MediaDeviceInfo[] }>({
    audioInputs: [],
    videoInputs: [],
  })
  const [selectedAudioId, setSelectedAudioId] = useState('')
  const [selectedVideoId, setSelectedVideoId] = useState('')

  const [remotePeers, setRemotePeers] = useState<RemotePeerState[]>([])
  const [activeSpeakerPeerId, setActiveSpeakerPeerId] = useState<string | null>(null)

  const peerIdRef = useRef<string>('')
  if (!peerIdRef.current && employee) {
    peerIdRef.current = `${employee.id}:${Math.random().toString(36).slice(2, 8)}`
  }

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const makingOfferRef = useRef<Map<string, boolean>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        audioInputs: list.filter((d) => d.kind === 'audioinput'),
        videoInputs: list.filter((d) => d.kind === 'videoinput'),
      })
    } catch {
      // ignore
    }
  }, [])

  // Acquire local camera/microphone safely
  const initLocalMedia = useCallback(
    async (audioDeviceId?: string, videoDeviceId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaNotice('Camera/microphone API unavailable in this browser context. Connected in receive-only mode.')
        return null
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
          video: videoDeviceId ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : true,
        })
        stream.getAudioTracks().forEach((t) => {
          t.enabled = micOn
        })
        stream.getVideoTracks().forEach((t) => {
          t.enabled = camOn
        })
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null
        localStreamRef.current = stream
        setLocalStream(stream)
        setMediaNotice(null)
        await refreshDevices()
        return stream
      } catch {
        // Fallback: audio-only
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
            video: false,
          })
          audioStream.getAudioTracks().forEach((t) => {
            t.enabled = micOn
          })
          localStreamRef.current = audioStream
          setLocalStream(audioStream)
          setCamOn(false)
          setMediaNotice('Camera not detected or in use by another app — connected with microphone audio.')
          await refreshDevices()
          return audioStream
        } catch {
          setMicOn(false)
          setCamOn(false)
          setMediaNotice('No camera/microphone detected — connected in receive-only WebRTC mode.')
          await refreshDevices()
          return null
        }
      }
    },
    [micOn, camOn, refreshDevices]
  )

  useEffect(() => {
    if (!joinedRoom) return
    let cancelled = false
    initLocalMedia().then((s) => {
      if (cancelled && s) {
        s.getTracks().forEach((t) => t.stop())
      }
    })
    return () => {
      cancelled = true
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      setLocalStream(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedRoom])

  // Sync presence state when mic/cam/screen/hand change
  const publishPresence = useCallback(() => {
    const ch = channelRef.current
    if (!ch || !employee) return
    ch.track({
      peerId: peerIdRef.current,
      employeeId: employee.id,
      employeeCode: employee.employee_code,
      fullName: employee.full_name,
      designation: employee.designation,
      avatarUrl: employee.avatar_url,
      micOn,
      camOn,
      screenSharing,
      handRaised,
    })
  }, [employee, micOn, camOn, screenSharing, handRaised])

  useEffect(() => {
    if (joinedRoom) {
      publishPresence()
    }
  }, [joinedRoom, publishPresence])

  // Setup WebRTC signaling over Supabase Realtime private channel
  useEffect(() => {
    if (!joinedRoom || !employee || !meetingId) return

    const myPeerId = peerIdRef.current
    const channel = supabase.channel(`meeting:${meetingId}:rtc`, {
      config: {
        private: true,
        presence: { key: myPeerId },
      },
    })
    channelRef.current = channel

    const createOrGetPeerConnection = (remotePeerId: string) => {
      const existing = pcsRef.current.get(remotePeerId)
      if (existing) return existing

      const pc = new RTCPeerConnection(RTC_CONFIG)
      pcsRef.current.set(remotePeerId, pc)

      const stream = localStreamRef.current
      if (stream) {
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream)
        })
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          channel.send({
            type: 'broadcast',
            event: 'rtc-signal',
            payload: {
              to: remotePeerId,
              from: myPeerId,
              candidate: ev.candidate,
            },
          })
        }
      }

      pc.ontrack = (ev) => {
        const inboundStream = ev.streams[0] || new MediaStream([ev.track])
        remoteStreamsRef.current.set(remotePeerId, inboundStream)
        setRemotePeers((prev) =>
          prev.map((p) => (p.peerId === remotePeerId ? { ...p, stream: inboundStream } : p))
        )
      }

      pc.onnegotiationneeded = async () => {
        try {
          makingOfferRef.current.set(remotePeerId, true)
          await pc.setLocalDescription()
          channel.send({
            type: 'broadcast',
            event: 'rtc-signal',
            payload: {
              to: remotePeerId,
              from: myPeerId,
              description: pc.localDescription,
            },
          })
        } catch {
          // ignore race
        } finally {
          makingOfferRef.current.set(remotePeerId, false)
        }
      }

      return pc
    }

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Omit<RemotePeerState, 'stream'>>()
        const peersList: RemotePeerState[] = []
        const activeIds = new Set<string>()

        for (const entries of Object.values(state)) {
          for (const entry of entries) {
            if (!entry.peerId || entry.peerId === myPeerId) continue
            activeIds.add(entry.peerId)
            peersList.push({
              ...entry,
              stream: remoteStreamsRef.current.get(entry.peerId) ?? null,
            })
            const pc = createOrGetPeerConnection(entry.peerId)
            if (myPeerId > entry.peerId && pc.signalingState === 'stable' && pc.getSenders().length === 0) {
              // Ensure transceivers for receive-only peers
              pc.addTransceiver('audio', { direction: 'recvonly' })
              pc.addTransceiver('video', { direction: 'recvonly' })
            }
          }
        }

        // Clean up departed peers
        for (const [pid, pc] of pcsRef.current.entries()) {
          if (!activeIds.has(pid)) {
            pc.close()
            pcsRef.current.delete(pid)
            remoteStreamsRef.current.delete(pid)
          }
        }

        setRemotePeers(peersList)
      })
      .on('broadcast', { event: 'rtc-signal' }, async ({ payload }) => {
        if (!payload || payload.to !== myPeerId) return
        const remotePeerId = payload.from as string
        const pc = createOrGetPeerConnection(remotePeerId)
        const polite = myPeerId < remotePeerId

        try {
          if (payload.description) {
            const desc = payload.description as RTCSessionDescriptionInit
            const offerCollision =
              desc.type === 'offer' &&
              (makingOfferRef.current.get(remotePeerId) || pc.signalingState !== 'stable')

            if (offerCollision && !polite) return

            await pc.setRemoteDescription(desc)
            if (desc.type === 'offer') {
              await pc.setLocalDescription()
              channel.send({
                type: 'broadcast',
                event: 'rtc-signal',
                payload: {
                  to: remotePeerId,
                  from: myPeerId,
                  description: pc.localDescription,
                },
              })
            }
          } else if (payload.candidate) {
            await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit)
          }
        } catch {
          // ignore transient ICE errors
        }
      })
      .on('broadcast', { event: 'organizer-control' }, ({ payload }) => {
        if (!payload || payload.targetEmployeeId !== employee.id) return
        if (payload.command === 'mute') {
          localStreamRef.current?.getAudioTracks().forEach((t) => {
            t.enabled = false
          })
          setMicOn(false)
          onForcedMute?.()
        } else if (payload.command === 'remove') {
          onRemoved?.()
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          publishPresence()
        }
      })

    return () => {
      for (const pc of pcsRef.current.values()) {
        pc.close()
      }
      pcsRef.current.clear()
      remoteStreamsRef.current.clear()
      supabase.removeChannel(channel)
      channelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedRoom, meetingId, employee?.id])

  // Attach local tracks to existing PCs if media initialized after channel connected
  useEffect(() => {
    if (!localStream) return
    for (const pc of pcsRef.current.values()) {
      const senders = pc.getSenders()
      for (const track of localStream.getTracks()) {
        const existingSender = senders.find((s) => s.track?.kind === track.kind)
        if (existingSender) {
          existingSender.replaceTrack(track).catch(() => {})
        } else {
          pc.addTrack(track, localStream)
        }
      }
    }
  }, [localStream])

  // Audio-level active speaker detection
  useEffect(() => {
    if (!joinedRoom) return
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    let ctx: AudioContext | null = null
    try {
      ctx = new AudioCtx()
    } catch {
      return
    }

    const analysers = new Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>()
    const attach = (peerId: string, stream: MediaStream | null) => {
      if (!ctx || !stream || stream.getAudioTracks().length === 0) return
      try {
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        src.connect(analyser)
        analysers.set(peerId, { analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) })
      } catch {
        // ignore
      }
    }

    if (micOn && localStream) attach('local', localStream)
    for (const p of remotePeers) {
      if (p.micOn && p.stream) attach(p.peerId, p.stream)
    }

    const timer = window.setInterval(() => {
      let bestId: string | null = null
      let bestLevel = 16
      for (const [id, item] of analysers.entries()) {
        item.analyser.getByteFrequencyData(item.data)
        let sum = 0
        for (let i = 0; i < item.data.length; i++) sum += item.data[i]
        const avg = sum / item.data.length
        if (avg > bestLevel) {
          bestLevel = avg
          bestId = id
        }
      }
      if (bestId) setActiveSpeakerPeerId(bestId)
    }, 350)

    return () => {
      window.clearInterval(timer)
      ctx?.close().catch(() => {})
    }
  }, [joinedRoom, localStream, micOn, remotePeers])

  const toggleMic = useCallback(() => {
    setMicOn((prev) => {
      const next = !prev
      localStreamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = next
      })
      return next
    })
  }, [])

  const toggleCam = useCallback(() => {
    setCamOn((prev) => {
      const next = !prev
      localStreamRef.current?.getVideoTracks().forEach((t) => {
        t.enabled = next
      })
      return next
    })
  }, [])

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    setScreenSharing(false)

    const camTrack = cameraTrackRef.current
    if (camTrack && localStreamRef.current) {
      const oldVideo = localStreamRef.current.getVideoTracks()[0]
      if (oldVideo && oldVideo !== camTrack) {
        localStreamRef.current.removeTrack(oldVideo)
        localStreamRef.current.addTrack(camTrack)
      }
      for (const pc of pcsRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        await sender?.replaceTrack(camTrack).catch(() => {})
      }
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
    }
  }, [])

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      await stopScreenShare()
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaNotice('Screen sharing is not supported in this browser.')
      return
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const screenTrack = displayStream.getVideoTracks()[0]
      screenStreamRef.current = displayStream
      setScreenSharing(true)

      screenTrack.onended = () => {
        stopScreenShare()
      }

      if (localStreamRef.current) {
        const oldVideo = localStreamRef.current.getVideoTracks()[0]
        if (oldVideo) localStreamRef.current.removeTrack(oldVideo)
        localStreamRef.current.addTrack(screenTrack)
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      } else {
        localStreamRef.current = displayStream
        setLocalStream(displayStream)
      }

      for (const pc of pcsRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) {
          await sender.replaceTrack(screenTrack).catch(() => {})
        } else {
          pc.addTrack(screenTrack, localStreamRef.current)
        }
      }
    } catch {
      // user cancelled screen share picker
    }
  }, [screenSharing, stopScreenShare])

  const sendOrganizerCommand = useCallback((targetEmployeeId: string, command: 'mute' | 'remove') => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'organizer-control',
      payload: { targetEmployeeId, command },
    })
  }, [])

  const switchMediaDevices = useCallback(
    async (audioId: string, videoId: string) => {
      setSelectedAudioId(audioId)
      setSelectedVideoId(videoId)
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      await initLocalMedia(audioId || undefined, videoId || undefined)
    },
    [initLocalMedia]
  )

  return {
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
  }
}
