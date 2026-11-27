# Module 03: Company Organization, Employee & Team Management

## Purpose
Provides Super Admins with unified Department, Designation, Leadership, Employee, and Meeting governance inside both the Admin Dashboard (`DashboardPage.tsx` -> `AdminModulesSection.tsx`) and `/employees` (`EmployeesPage.tsx`), powers the five-tier Company Organization & Team Directory (`TeamsPage.tsx`), and connects active employees directly into Meeting scheduling (`ScheduleMeetingPage.tsx`).

## Connected Files
- `src/components/admin/AdminModulesSection.tsx` — Five-tab Admin Command Hub embedded in `DashboardPage.tsx` (`super_admin` only).
- `src/components/admin/DepartmentManagementPanel.tsx` — Create unlimited departments, assign heads, set display order, toggle active/inactive, and guard in-use deletions (`prevent_in_use_department_delete_trg`).
- `src/components/admin/DesignationManagementPanel.tsx` — Department-scoped custom designations with hierarchy levels (`1..999`), cross-department template cloning, and in-use delete protection (`prevent_in_use_designation_delete_trg`).
- `src/components/admin/LeadershipManagementPanel.tsx` & `EmployeeManagementPanel.tsx` — Employee & leadership lifecycle controls.
- `src/components/admin/MeetingManagementPanel.tsx` — Admin Dashboard Meeting Management console.
- `src/components/employees/EmployeeFormModal.tsx` — Shared form dynamically filtering active Designations for the selected Department, setting Employee IDs in `AIPL-(numbers)` format (auto-hidden when editing/adding Founding Members), uploading photos (`avatars`), and toggling Active/Inactive status.
- `src/lib/orgUtils.ts` — Shared helpers (`isFoundingMember`, `isValidAiplEmployeeId`, `getDisplayEmployeeId`, `generateNextAiplCode`).
- `src/pages/TeamsPage.tsx` — Five-tier hierarchy: (1) Founders & Managing Director, (2) Associate Director & Leadership, (3) Department Heads, (4) Managers, (5) Employees, synced in real time with `supabase_realtime`.
- `src/pages/ScheduleMeetingPage.tsx` — Multi-department filtering, bulk department invites, Department Head/Manager quick-select, inactive-staff exclusion, and official email dispatch (`meeting-access`).
- `supabase/functions/admin-manage-users/index.ts` — Provisioning, category/designation sync, `employee_social_links` updates, and archive-safe deletion protecting all historical meetings & attendance.
- Database Schema (`20261126000004_organization_departments_designations.sql`): `public.departments` (8 seeded: `MGT`, `ITN`, `AV`, `PRJ`, `SCM`, `FIN`, `BD`, `HR`), `public.designations` (17 seeded), `public.employee_categories` (7 canonical tiers), `public.employee_social_links`, `public.employees`, `public.meetings`, `public.meeting_participants`.

## Working Flow
1. **Department & Designation Management:**
   - Super Admins manage active departments (`Management`, `IT & Networking`, `Audio Visual (AV)`, `Projects & Engineering`, `Supply Chain Management (SCM)`, `Accounts & Finance`, `Business Development`, `Human Resources (HR)`, plus any custom divisions) and custom hierarchical designations assigned per department.
   - Database triggers strictly block deleting any department or designation referenced by active or pending-invite employees until reassigned.
2. **Employee Provisioning & Safe Archiving (`EmployeeFormModal.tsx` & `admin-manage-users`):**
   - Choosing a Department automatically filters Designations to that department and pre-suggests its default hierarchy category.
   - Removing an employee with any existing `meetings`, `meeting_participants`, `attendance`, `meeting_messages`, or `meeting_activity_logs` records archives them (`status = 'inactive'`) instead of deleting, keeping historical meeting logs intact.
3. **Meeting Invitations Integration (`ScheduleMeetingPage.tsx` & `meeting-access`):**
   - Only `status = 'active'` employees appear in invite searches and Postgres `prevent_inactive_meeting_invite_trg` prevents inviting inactive staff.
   - Selected participants are previewed with their registered official email addresses before sending invitations (`dispatch_schedule_invites`).
