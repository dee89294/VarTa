# Module 06: Live Video Conferencing (WebRTC)

## Purpose
Delivers real-time peer-to-peer video, audio, screen sharing, active speaker detection, and meeting controls inside `LiveMeetingPage.tsx` without simulated static media.

## Connected Files
- `src/hooks/useWebRTCMeeting.ts` — WebRTC `RTCPeerConnection` engine, hardware device management, screen-share track replacement, Web Audio `AnalyserNode` speaker detection, and Realtime signaling.
- `src/pages/LiveMeetingPage.tsx` — Automatically opens in distraction-free full-screen (`fixed inset-0 z-50 h-screen w-screen`) with a slim right-edge glassmorphic icon sidebar collapsed by default (`Participants`, `Chat`, `Meeting Details`, `Notes`, `Screen Sharing`, `Recording`, `Settings`) plus slide-in panels and a minimizable PiP widget.
- `src/App.tsx` — `WorkspaceWithCallHost` keeps WebRTC sessions alive across Dashboard/Calendar/Reports navigation when minimized.
- `supabase/migrations/20261126000001_initial_varta_schema.sql` — Private Realtime RLS (`realtime.messages` + `private.can_access_realtime_topic()`).

## Working Flow
1. **Media Acquisition (`initLocalMedia`):** Once `gateState === 'in_call'`, requests camera + mic via `navigator.mediaDevices.getUserMedia`. Falls back cleanly to audio-only or receive-only mode if hardware devices are absent or busy.
2. **Private Realtime Channel:** Joins `meeting:<meetingId>:rtc` (`config: { private: true }`). Only users admitted to `meeting_participants` or the organizer pass `private.can_access_realtime_topic()`.
3. **Presence & Perfect Negotiation:**
   - Publishes `{ peerId, employeeId, employeeCode, fullName, micOn, camOn, screenSharing, handRaised }` to Realtime Presence.
   - Establishes `RTCPeerConnection` per peer using STUN (`stun.l.google.com:19302`) and resolves offer collisions deterministically (`myPeerId < remotePeerId` polite rule) over Broadcast (`rtc-signal`).
4. **Screen Sharing & Device Switching:**
   - `toggleScreenShare()` captures `getDisplayMedia()`, swaps the outgoing video track on every active `RTCPeerConnection` via `sender.replaceTrack()`, and restores the camera track when ended.
5. **Active Speaker Detection:**
   - Samples `AudioContext` `AnalyserNode` levels every 350ms across unmuted streams to highlight the active speaker tile in Speaker View unless another tile is manually pinned.
6. **Host Moderation:**
   - Organizer clicks Mute or Remove -> broadcasts `organizer-control` event and updates `meeting_participants.admission_status` via `meeting-access`.
