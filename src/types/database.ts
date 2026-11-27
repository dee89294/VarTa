/**
 * File: src/types/database.ts
 * Purpose: TypeScript interfaces mirroring all Postgres tables and enum constraints in the `public` schema.
 * Why required: Ensures compile-time type safety across Supabase queries, React state, Contexts, and UI components.
 * Connected files:
 *   - `supabase/migrations/20261126000001_initial_varta_schema.sql` & `20261126000004_organization_departments_designations.sql`
 *   - `src/contexts/AuthContext.tsx` (`Employee`, `UserRole`)
 *   - `src/components/ui/StatusBadge.tsx` (`UserRole`, `OrgCategory`, `EmployeeStatus`, `MeetingStatus`, `AttendanceStatus`)
 *   - All pages under `src/pages/*` and components under `src/components/admin/*`
 */

/** Application RBAC roles enforced by `public.user_roles`, RLS policies, and Edge Functions. */
export type UserRole = 'super_admin' | 'organizer' | 'employee'

/** Canonical 7 organization hierarchy categories stored in `public.employee_categories` and `employees.org_category`. */
export type OrgCategory =
  | 'founder'
  | 'managing_director'
  | 'director'
  | 'leadership'
  | 'department_head'
  | 'manager'
  | 'employee'

export type MemberCategory = OrgCategory | 'co_founder'

export type EmployeeStatus = 'invited' | 'active' | 'inactive'
export type MeetingStatus = 'scheduled' | 'live' | 'completed' | 'cancelled'
export type AdmissionStatus = 'invited' | 'waiting' | 'admitted' | 'rejected' | 'removed'
export type AttendanceStatus = 'waiting' | 'present' | 'absent'

/** Maps to `public.departments` — dynamic organizational units supporting heads, ordering, and active/inactive state. */
export interface Department {
  id: string
  name: string
  code: string
  description: string
  head_employee_id: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  head_employee?: Pick<Employee, 'id' | 'employee_code' | 'full_name' | 'designation' | 'avatar_url'> | null
}

/** Maps to `public.designations` — department-scoped, hierarchical, and reusable designations. */
export interface Designation {
  id: string
  department_id: string
  title: string
  description: string
  hierarchy_level: number
  default_category: OrgCategory
  is_active: boolean
  created_at: string
  updated_at: string
  department?: Pick<Department, 'id' | 'name' | 'code'> | null
}

/** Maps to `public.employee_categories` — hierarchy metadata for UI tiers. */
export interface EmployeeCategoryOption {
  id: string
  slug: OrgCategory
  name: string
  tier_group: 'founders_md' | 'director_leadership' | 'department_heads' | 'managers' | 'employees'
  hierarchy_rank: number
  card_scale: 'large' | 'medium' | 'compact'
  description: string
  created_at: string
}

/** Maps to `public.employee_social_links` — normalized social profiles linked to employees. */
export interface EmployeeSocialLink {
  id: string
  employee_id: string
  platform: 'linkedin' | 'twitter' | 'website' | 'github' | 'other'
  url: string
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  department_id: string
  name: string
  description: string
  lead_employee_id: string | null
  created_at: string
  updated_at: string
  department?: Department | null
}

export interface Employee {
  id: string
  auth_user_id: string | null
  employee_code: string
  full_name: string
  email: string
  phone: string
  department_id: string | null
  team_id: string | null
  designation_id: string | null
  designation: string
  category_id: string | null
  org_category: OrgCategory
  is_founding_member?: boolean
  avatar_url: string | null
  bio: string
  status: EmployeeStatus
  intended_role: UserRole
  member_category: MemberCategory
  display_order: number
  linkedin_url: string
  twitter_url: string
  website_url: string
  date_of_joining: string
  invited_at: string
  registered_at: string | null
  created_at: string
  updated_at: string
  department?: { id: string; name: string; code: string } | null
  team?: { id: string; name: string; department_id: string } | null
  designation_ref?: { id: string; title: string; hierarchy_level: number } | null
  social_links?: EmployeeSocialLink[]
}

export interface Meeting {
  id: string
  meeting_code: string
  title: string
  description: string
  organizer_id: string
  department_id: string | null
  team_id: string | null
  invited_department_ids?: string[]
  scheduled_start: string
  scheduled_end: string
  duration_minutes: number
  status: MeetingStatus
  waiting_room_enabled: boolean
  is_locked: boolean
  allow_chat: boolean
  allow_screen_share: boolean
  meeting_notes?: string
  actual_started_at: string | null
  actual_ended_at: string | null
  created_at: string
  updated_at: string
  organizer?: Pick<Employee, 'id' | 'employee_code' | 'full_name' | 'email' | 'designation' | 'avatar_url'> | null
  department?: { id: string; name: string; code: string } | null
  team?: { id: string; name: string } | null
  meeting_participants?: MeetingParticipant[]
  meeting_agenda?: MeetingAgendaItem[]
}

export interface MeetingParticipant {
  id: string
  meeting_id: string
  employee_id: string
  role_in_meeting: 'organizer' | 'participant'
  admission_status: AdmissionStatus
  invited_by: string | null
  invitation_source?: 'individual' | 'department' | 'department_heads' | 'managers' | 'leadership'
  invited_email?: string
  invitation_sent_at?: string | null
  created_at: string
  updated_at: string
  employee?: Employee | null
}

export interface AttendanceRecord {
  id: string
  meeting_id: string
  employee_id: string
  status: AttendanceStatus
  join_time: string | null
  leave_time: string | null
  last_heartbeat_at: string | null
  total_duration_seconds: number
  verified_entry: boolean
  updated_at: string
  employee?: Employee | null
  meeting?: Meeting | null
}

export interface MeetingMessage {
  id: string
  meeting_id: string
  sender_employee_id: string
  sender_name: string
  sender_code: string
  content: string
  message_type: 'text' | 'system' | 'reaction'
  created_at: string
}

export interface MeetingAgendaItem {
  id: string
  meeting_id: string
  position: number
  title: string
  duration_minutes: number
  presenter_name: string
  is_completed: boolean
  created_at: string
}

export interface NotificationItem {
  id: string
  recipient_employee_id: string
  meeting_id: string | null
  type: string
  title: string
  message: string
  is_read: boolean
  created_at: string
}

export interface AnnouncementItem {
  id: string
  title: string
  content: string
  priority: 'info' | 'important' | 'urgent'
  author_employee_id: string | null
  created_at: string
  author?: Pick<Employee, 'full_name' | 'designation' | 'employee_code'> | null
}

export interface ActivityLogItem {
  id: string
  meeting_id: string
  actor_employee_id: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
  actor?: Pick<Employee, 'full_name' | 'employee_code'> | null
  meeting?: Pick<Meeting, 'title' | 'meeting_code'> | null
}

export interface PlatformSettings {
  id: number
  company_name: string
  default_waiting_room: boolean
  prevent_double_booking: boolean
  attendance_grace_minutes: number
  allow_employee_directory: boolean
  smtp_enabled?: boolean
  smtp_host?: string
  smtp_port?: number
  smtp_user?: string
  smtp_pass?: string
  smtp_secure?: boolean
  smtp_from_email?: string
  smtp_from_name?: string
  updated_by: string | null
  updated_at: string
}
