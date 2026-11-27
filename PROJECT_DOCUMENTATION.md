# VarTa — Project Architecture & Developer Documentation

VarTa is an enterprise **Company Meeting & Employee Management Platform** built with **React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion, WebRTC**, and **Supabase** (Auth, PostgreSQL with Row Level Security, Realtime, Storage, and Deno Edge Functions).

---

## 1. Complete Folder Structure

```text
VarTa/
├── .env.example                       # Template listing required public frontend env vars
├── .env.local                         # Local Vite environment variables (Supabase URL + publishable key)
├── index.html                         # Root HTML shell loading fonts and mounting /src/main.tsx
├── package.json                       # Dependencies (@supabase/supabase-js, framer-motion, xlsx, lucide-react, react-router-dom)
├── tsconfig.json                      # Strict TypeScript compiler configuration
├── vite.config.ts                     # Vite bundler configuration with React + Tailwind CSS v4 plugins
├── PROJECT_DOCUMENTATION.md           # This master architecture, file guide, and database reference
├── FILE_CONNECTIONS.md                # File-to-file dependency graph and cross-tier data flow diagrams
├── docs/
│   └── modules/                       # Dedicated step-by-step guides for all 11 core modules
│       ├── 01-authentication-and-registration.md
│       ├── 02-role-based-access-control.md
│       ├── 03-employee-and-team-management.md
│       ├── 04-meeting-scheduling.md
│       ├── 05-calendar-integration.md
│       ├── 06-video-conferencing.md
│       ├── 07-participant-authorization.md
│       ├── 08-live-attendance-tracking.md
│       ├── 09-realtime-chat.md
│       ├── 10-reports-and-analytics.md
│       └── 11-supabase-integration.md
├── supabase/
│   ├── migrations/
│   │   ├── 20261126000001_initial_varta_schema.sql      # Full Postgres DDL, indexes, triggers, RLS, Storage, Realtime
│   │   ├── 20261126000002_meeting_notes_column.sql      # Shared meeting notes persistence column
│   │   ├── 20261126000003_team_leadership_fields.sql    # Adds member_category, display_order, social URLs, employees Realtime
│   │   ├── 20261126000004_organization_departments_designations.sql # Adds designations, employee_categories, employee_social_links, department ordering/status, meeting multi-dept & official email invites
│   │   └── 20261126000005_aipl_id_and_founders_leadership_separation.sql # Enforces AIPL-(numbers) Employee IDs & isolates Founding Members in Leadership only
│   └── functions/
│       ├── employee-registration/index.ts            # Server-side HR invite verification & Auth signup
│       ├── admin-manage-users/index.ts               # Super Admin user CRUD, role assignment, account deactivation
│       ├── meeting-access/index.ts                   # Entry gate, waiting room, verified attendance, meeting lifecycle
│       └── bootstrap-seed/index.ts                   # One-time idempotent database & demo user seeder
└── src/
    ├── main.tsx                       # Mounts React root and imports global styles
    ├── App.tsx                        # Router, providers (Auth, Toast, MotionConfig), and route guards
    ├── index.css                      # Tailwind v4 + light lavender-alabaster surface utilities (.varta-canvas, .varta-card)
    ├── vite-env.d.ts                  # Vite client environment type declarations
    ├── types/
    │   └── database.ts                # TypeScript interfaces matching all Supabase tables & enums
    ├── lib/
    │   ├── supabase.ts                # Singleton Supabase client + invokeEdgeFunction() helper
    │   ├── utils.ts                   # Date/time/duration formatters, initials, gradients, meeting codes
    │   ├── orgUtils.ts                # Enforces AIPL-(numbers) Employee ID format & excludes Founding Members from Employee counts/lists
    │   └── export.ts                  # Client-side CSV & Excel (.xlsx) attendance exporters
    ├── contexts/
    │   ├── AuthContext.tsx            # Session, active employee profile, RBAC role, signOut & refreshProfile
    │   └── ToastContext.tsx           # Global animated toast notification system
    ├── hooks/
    │   └── useWebRTCMeeting.ts        # Peer-to-peer WebRTC media, screen share, active speaker, Realtime signaling
    ├── components/
    │   ├── admin/
    │   │   ├── AdminModulesSection.tsx        # 5-tab Super Admin Hub on DashboardPage (Employee, Dept, Designation, Leadership, Meeting)
    │   │   ├── DepartmentManagementPanel.tsx  # Unlimited departments CRUD, heads, active toggles, in-use delete protection
    │   │   ├── DesignationManagementPanel.tsx # Department-scoped designations CRUD, hierarchy priority, cross-dept cloning
    │   │   ├── EmployeeManagementPanel.tsx    # Shared directory table, category/dept/status filters, archive-safe deletion
    │   │   ├── LeadershipManagementPanel.tsx  # Founders, MD, Directors, Dept Heads, and Managers hierarchy panel
    │   │   └── MeetingManagementPanel.tsx     # Admin meeting overview, start/cancel controls, calendar & report shortcuts
    │   ├── employees/
    │   │   └── EmployeeFormModal.tsx  # Shared modal with dynamic Dept -> Designation cascade, 7 categories, status & photo upload
    │   ├── layout/
    │   │   └── AppShell.tsx           # Role-filtered sidebar, mobile drawer, quick search, live notifications bell
    │   └── ui/
    │       ├── Avatar.tsx             # Profile photo renderer with gradient initials fallback & status dot
    │       ├── Modal.tsx              # Animated modal dialog wrapper
    │       ├── MotionPrimitives.tsx   # Page transitions, scroll reveals, staggered grids, counters, skeletons
    │       └── StatusBadge.tsx        # Semantic badges + CategoryBadge (Founder, MD, Director, Leadership, Dept Head, Manager, Employee)
    └── pages/
        ├── LoginPage.tsx              # Sign-in page + role demo credential quick-fill
        ├── RegisterPage.tsx           # 2-step HR-verified employee registration page
        ├── DashboardPage.tsx          # Role-adaptive Bento Dashboard + Super Admin Command Hub + Employee Invites/History/Dept Colleagues
        ├── EmployeesPage.tsx          # Tabbed Organization & Employees Admin Console (`/employees`)
        ├── TeamsPage.tsx              # Five-tier Org & Team Directory (Founders/MD -> Directors -> Dept Heads -> Managers -> Employees)
        ├── ScheduleMeetingPage.tsx    # Multi-department & role-tier meeting invite builder with official email dispatch & preview
        ├── CalendarPage.tsx           # Monthly/Weekly/Daily calendar with locked events & organizer edit controls
        ├── MyMeetingsPage.tsx         # Assigned & Live meetings directory (/my-meetings & /live-meetings)
        ├── LiveMeetingPage.tsx        # Access gate, waiting room, WebRTC room, live attendance table, live chat
        ├── AttendancePage.tsx         # Attendance management console with filters & CSV/Excel export
        ├── ReportsPage.tsx            # Department compliance bars & per-meeting exportable audit reports
        └── SettingsPage.tsx           # Personal profile/photo/password settings & Super Admin governance policy
```

---

## 2. File-by-File Reference & Where to Make Changes

### Root & Core Configuration
| File | Purpose & Functionality Controlled | Connected Files | Where to Edit When Changing... |
|---|---|---|---|
| `vite.config.ts` | Configures Vite + React + Tailwind v4 plugin | `package.json`, `src/main.tsx`, `src/index.css` | Build plugins, dev server port, or chunk splitting |
| `src/App.tsx` | Defines all routes, `ProtectedRoute`, `WorkspaceWithCallHost` (Full Screen & Minimized live calls), global providers | `AuthContext.tsx`, `ToastContext.tsx`, `AppShell.tsx`, `src/pages/*` | Adding a page, changing route URLs, or updating call window overlay behavior |
| `src/index.css` | Lavender-alabaster theme canvas, crisp white cards, hover elevation, input/select tokens | `src/main.tsx`, `index.html`, all UI components | Changing color palette, shadows, or global hover CSS |

### Libraries, Types, Contexts & Hooks
| File | Purpose & Functionality Controlled | Connected Files | Where to Edit When Changing... |
|---|---|---|---|
| `src/lib/supabase.ts` | Creates `supabase` client and `invokeEdgeFunction()` | `.env.local`, all pages, `AuthContext.tsx`, Edge Functions | Changing Supabase client options or Edge Function request headers |
| `src/lib/utils.ts` | Formats dates/times/clocks/durations, generates `VRT-XXXX` codes | `Avatar.tsx`, `StatusBadge.tsx`, `LiveMeetingPage.tsx`, `AttendancePage.tsx` | Adjusting timestamp display formats or meeting code prefixes |
| `src/lib/export.ts` | Generates CSV and `.xlsx` Excel reports | `AttendancePage.tsx`, `ReportsPage.tsx`, `LiveMeetingPage.tsx` | Adding/renaming exported spreadsheet columns |
| `src/types/database.ts` | TypeScript interfaces matching PostgreSQL schema | SQL migration, `AuthContext.tsx`, all pages | Adding or renaming database columns |
| `src/contexts/AuthContext.tsx` | Loads `auth.users` + `employees` + `user_roles`; enforces active status | `App.tsx`, `AppShell.tsx`, `LoginPage.tsx`, `RegisterPage.tsx`, all pages | Changing how login state or user role metadata is resolved |
| `src/contexts/ToastContext.tsx` | Displays animated status notifications (`success`, `error`, `warning`, `info`) | `App.tsx`, all pages | Customizing toast duration, position, or styling |
| `src/hooks/useWebRTCMeeting.ts` | WebRTC `RTCPeerConnection` mesh, `getUserMedia`, `getDisplayMedia`, audio-level speaker detection, Realtime signaling | `LiveMeetingPage.tsx`, `supabase.ts`, `realtime.messages` RLS | Changing STUN/TURN servers, video constraints, or peer negotiation |

### Edge Functions (`supabase/functions/`)
| Edge Function | Called By | Database Tables Touched | Auth & Security |
|---|---|---|---|
| `employee-registration` | `RegisterPage.tsx` | `employees`, `departments`, `teams`, `user_roles`, `notifications`, `auth.users` | Unauthenticated (`verify_jwt: false`); verifies exact `employee_code` + `email` match and `status = 'invited'` before creating Auth account |
| `admin-manage-users` | `EmployeesPage.tsx`, `TeamsPage.tsx` | `user_roles`, `employees`, `notifications`, `meetings`, `auth.users` | Validates Bearer JWT and requires `user_roles.role === 'super_admin'` and `employees.status === 'active'` |
| `meeting-access` | `ScheduleMeetingPage.tsx`, `MyMeetingsPage.tsx`, `LiveMeetingPage.tsx` | `meetings`, `meeting_participants`, `attendance`, `notifications`, `meeting_activity_logs`, `meeting_messages`, `employees`, `user_roles` | Validates Bearer JWT + active employee; enforces organizer/participant allowlist; marks `present` only on `confirm_entry` |
| `bootstrap-seed` | Initial setup only | All core tables + `auth.users` | Refuses execution if `public.employees` already contains rows |

---

## 3. Supabase Database Schema Documentation

All tables reside in the `public` schema with **Row Level Security (RLS)** enabled, backed by isolated helper functions in the `private` schema (`private.current_employee_id()`, `private.current_role()`, `private.is_super_admin()`, `private.is_organizer_or_admin()`, `private.is_meeting_organizer()`, `private.is_meeting_participant()`, `private.is_admitted_to_meeting()`, `private.can_access_realtime_topic()`).

### 1. `public.departments`
- **Purpose:** Organizational departments (e.g., `ENG`, `PRD`, `OPS`, `REV`).
- **Key Columns & FKs:** `id` (PK), `name` (unique), `code` (unique), `description`, `head_employee_id` (FK -> `employees.id`).
- **Connected Files:** `EmployeesPage.tsx`, `TeamsPage.tsx`, `ScheduleMeetingPage.tsx`, `AttendancePage.tsx`, `ReportsPage.tsx`.
- **RLS:** Readable by all active employees; writable only by `super_admin`.

### 2. `public.teams`
- **Purpose:** Sub-teams within departments.
- **Key Columns & FKs:** `id` (PK), `department_id` (FK -> `departments.id`), `name`, `description`, `lead_employee_id` (FK -> `employees.id`).
- **Connected Files:** `TeamsPage.tsx`, `EmployeesPage.tsx`, `ScheduleMeetingPage.tsx`, `AttendancePage.tsx`.
- **RLS:** Readable by all active employees; writable only by `super_admin`.

### 3. `public.employees`
- **Purpose:** Master employee directory, leadership/team showcase tier, and onboarding state (`invited`, `active`, `inactive`).
- **Key Columns & FKs:** `id` (PK), `auth_user_id` (unique FK -> `auth.users.id`), `employee_code` (unique `EMP...`), `full_name`, `email` (unique lowercase), `phone`, `department_id` (FK -> `departments.id`), `team_id` (FK -> `teams.id`), `designation`, `member_category` (`'founder' | 'co_founder' | 'director' | 'leadership' | 'employee'`), `display_order`, `linkedin_url`, `twitter_url`, `website_url`, `avatar_url`, `bio`, `status`, `intended_role`, `date_of_joining`.
- **Connected Files:** `AuthContext.tsx`, `RegisterPage.tsx`, `EmployeeFormModal.tsx`, `EmployeesPage.tsx`, `TeamsPage.tsx`, `SettingsPage.tsx`, `employee-registration`, `admin-manage-users`.
- **RLS, Realtime & Trigger:** Published on `supabase_realtime` so `TeamsPage.tsx` syncs live updates. Super Admins can view/insert/update/delete all records. Active employees can view active colleagues and update only allowed profile fields (`member_category`, `display_order`, and governance columns are protected for non-super-admins by `private.protect_employee_columns()` trigger).

### 4. `public.user_roles`
- **Purpose:** Authoritative role assignment (`super_admin`, `organizer`, `employee`).
- **Key Columns & FKs:** `id` (PK), `user_id` (unique FK -> `auth.users.id`), `employee_id` (unique FK -> `employees.id`), `role`, `assigned_by` (FK -> `auth.users.id`).
- **Connected Files:** `AuthContext.tsx`, `private.current_role()`, `admin-manage-users`, `employee-registration`.
- **RLS:** Users read their own row; Super Admins read and manage all rows.

### 5. `public.meetings`
- **Purpose:** Stores scheduled, live, completed, and cancelled meetings locked on the calendar.
- **Key Columns & FKs:** `id` (PK), `meeting_code` (unique `VRT-XXXX`), `title`, `description`, `organizer_id` (FK -> `employees.id`), `department_id`, `team_id`, `scheduled_start`, `scheduled_end`, `duration_minutes`, `status`, `waiting_room_enabled`, `is_locked`, `actual_started_at`, `actual_ended_at`.
- **Connected Files:** `DashboardPage.tsx`, `ScheduleMeetingPage.tsx`, `CalendarPage.tsx`, `MyMeetingsPage.tsx`, `LiveMeetingPage.tsx`, `ReportsPage.tsx`, `meeting-access`.
- **RLS & Trigger:** Super Admins see all; Organizers/Employees see only meetings they organize or are invited to. `private.enforce_meeting_integrity()` locks completed/cancelled meetings and prevents overlapping organizer bookings.

### 6. `public.meeting_participants`
- **Purpose:** Strict meeting invite allowlist and waiting-room admission status (`invited`, `waiting`, `admitted`, `rejected`, `removed`).
- **Key Columns & FKs:** `id` (PK), `meeting_id` (FK -> `meetings.id`), `employee_id` (FK -> `employees.id`), `role_in_meeting`, `admission_status`, `invited_by` (FK -> `employees.id`). Unique `(meeting_id, employee_id)`.
- **Connected Files:** `ScheduleMeetingPage.tsx`, `CalendarPage.tsx`, `MyMeetingsPage.tsx`, `LiveMeetingPage.tsx`, `meeting-access`.
- **RLS:** Readable by organizer, Super Admin, and meeting participants; writable by organizer or Super Admin (or Edge Function `meeting-access`).

### 7. `public.attendance`
- **Purpose:** Authoritative verified attendance record (`waiting`, `present`, `absent`), entry verification flag (`verified_entry`), join/leave timestamps, and participation duration (`total_duration_seconds`).
- **Key Columns & FKs:** `id` (PK), `meeting_id` (FK -> `meetings.id`), `employee_id` (FK -> `employees.id`), `status`, `join_time`, `leave_time`, `last_heartbeat_at`, `total_duration_seconds`, `verified_entry`. Unique `(meeting_id, employee_id)`.
- **Connected Files:** `meeting-access` (writes verified attendance), `LiveMeetingPage.tsx`, `AttendancePage.tsx`, `ReportsPage.tsx`, `DashboardPage.tsx`.
- **RLS:** Employees can read ONLY their own rows; Organizers can read rows for meetings they organize; Super Admins read all. Employees cannot directly mark themselves `present` from client SQL.

### 8. `public.meeting_messages`
- **Purpose:** Persisted real-time chat messages and system call events.
- **Key Columns & FKs:** `id` (PK), `meeting_id` (FK -> `meetings.id`), `sender_employee_id` (FK -> `employees.id`), `sender_name`, `sender_code`, `content`, `message_type`, `created_at`.
- **Connected Files:** `LiveMeetingPage.tsx`, `meeting-access` (system start message).
- **RLS:** Accessible ONLY to the meeting organizer, Super Admin, or participants whose `admission_status = 'admitted'`.

### 9. `public.meeting_agenda`
- **Purpose:** Ordered talking points per meeting.
- **Key Columns & FKs:** `id` (PK), `meeting_id` (FK -> `meetings.id`), `position`, `title`, `duration_minutes`, `presenter_name`, `is_completed`.
- **Connected Files:** `ScheduleMeetingPage.tsx`, `CalendarPage.tsx`, `LiveMeetingPage.tsx`.

### 10. `public.notifications`
- **Purpose:** Real-time per-employee notifications (meeting invites, reschedules, cancellations, waiting room alerts, join/leave, meeting start/end).
- **Key Columns & FKs:** `id` (PK), `recipient_employee_id` (FK -> `employees.id`), `meeting_id` (FK -> `meetings.id`), `type`, `title`, `message`, `is_read`, `created_at`.
- **Connected Files:** `AppShell.tsx` (bell + Realtime stream), `ScheduleMeetingPage.tsx`, `CalendarPage.tsx`, `meeting-access`, `admin-manage-users`, `employee-registration`.

### 11. `public.announcements`, `public.meeting_activity_logs`, `public.platform_settings`
- **`announcements`:** Company-wide bulletins displayed on `DashboardPage.tsx`.
- **`meeting_activity_logs`:** Audit trail of scheduled, started, joined, left, and ended events.
- **`platform_settings`:** Singleton organization configuration row managed on `SettingsPage.tsx`.

---

## 4. Security Architecture Summary

1. **No Secret Keys in Frontend:** Browser code uses only `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_PUBLISHABLE_KEY` (`apikey` header). Service/secret keys stay exclusively inside Supabase Edge Functions (`Deno.env`).
2. **Server-Side Onboarding Verification:** Random signups cannot access the platform because `public.employees` requires pre-creation by a Super Admin and verification via `employee-registration`.
3. **Server-Side Meeting Gate:** Uninvited employees are rejected with `403 Access Denied` by `meeting-access`, blocked from querying meetings/messages by RLS, and blocked from private Realtime channels by `private.can_access_realtime_topic()`.
4. **Verified Attendance:** Joining (`action: 'join'`) never marks `present`; only `confirm_entry` after passing authorization and waiting room admission sets `status = 'present'` and `verified_entry = true`.
