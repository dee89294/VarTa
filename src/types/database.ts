/**
 * File: src/types/database.ts
 * Purpose: TypeScript interfaces mirroring the streamlined VARTA PostgreSQL schema
 *   (`profiles`, `meetings`, `meeting_invitations`, `meeting_participants`,
 *    `meeting_tasks`, `meeting_messages`).
 * Connected files:
 *   - `supabase/migrations/20261128000001_varta_clean_livekit_schema.sql`
 *   - `supabase/migrations/20261128000003_meeting_dashboard_workspace.sql`
 *   - `src/contexts/AuthContext.tsx` (`Profile`)
 *   - `src/pages/DashboardPage.tsx`, `CreateMeetingPage.tsx`, `MyMeetingsPage.tsx`, `MeetingRoomPage.tsx`
 */

export type MeetingStatus = 'scheduled' | 'active' | 'ended' | 'cancelled'
export type RecordingStatus = 'idle' | 'recording' | 'paused'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked'
export type ParticipantType = 'organizer' | 'registered' | 'guest'
export type AdmissionStatus = 'waiting' | 'admitted' | 'removed'
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** Maps to `public.profiles` — registered VARTA users linked 1:1 with `auth.users`. */
export interface Profile {
  id: string
  full_name: string
  email: string
  created_at: string
  updated_at: string
}

/** Maps to `public.meeting_invitations` — email invitations tracked via hashed tokens. */
export interface MeetingInvitation {
  id: string
  meeting_id: string
  invitee_email: string
  invitation_status: InvitationStatus
  created_at: string
  updated_at: string
}

/** Maps to `public.meeting_participants` — both registered users and unauthenticated guests. */
export interface MeetingParticipant {
  id: string
  meeting_id: string
  user_id: string | null
  full_name: string
  email: string | null
  participant_type: ParticipantType
  participant_identity: string
  admission_status: AdmissionStatus
  joined_at: string
  left_at: string | null
}

/** Maps to `public.meeting_tasks` — interactive meeting action items in the room dashboard. */
export interface MeetingTask {
  id: string
  meeting_id: string
  title: string
  status: TaskStatus
  is_completed: boolean
  assigned_to: string
  due_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Maps to `public.meeting_messages` — real-time room chat history persisted in Supabase. */
export interface MeetingMessage {
  id: string
  meeting_id: string
  user_id: string | null
  participant_identity: string
  sender_name: string
  sender_role: ParticipantType
  message_text: string
  created_at: string
}

/** Maps to `public.meetings` — scheduled or instant meetings hosted by an organizer. */
export interface Meeting {
  id: string
  meeting_code: string
  meeting_title: string
  organizer_id: string
  meeting_status: MeetingStatus
  is_instant: boolean
  waiting_room_enabled: boolean
  description?: string
  agenda?: string
  discussion_points?: string
  recording_status?: RecordingStatus
  recording_started_at?: string | null
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
  organizer?: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  meeting_invitations?: MeetingInvitation[]
  meeting_participants?: MeetingParticipant[]
}
