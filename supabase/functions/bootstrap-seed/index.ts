/**
 * Edge Function: bootstrap-seed
 * Purpose: Strictly one-time database seeder populating initial departments, teams, active & invited
 *   employees, Auth users, sample meetings (live, scheduled, completed, cancelled), attendance, agendas,
 *   chat messages, announcements, and notifications.
 * Why required: Populates a brand-new empty VarTa Supabase project with realistic relational test data
 *   and properly hashed GoTrue Auth accounts via `auth.admin.createUser()`.
 * Safety guard: Immediately returns `{ status: 'already_seeded' }` if any row already exists in `public.employees`.
 * Tables accessed: `departments`, `teams`, `employees`, `user_roles`, `meetings`, `meeting_participants`,
 *   `attendance`, `meeting_agenda`, `meeting_messages`, `announcements`, `meeting_activity_logs`, `notifications`, `auth.users`.
 * Impact if modified/removed: Only used for initial empty-project seeding; existing seeded data is unaffected.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function getSecretKey(): string {
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw)
      if (parsed?.default) return parsed.default
    } catch {
      // ignore
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSecretKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Strictly one-time bootstrap: refuse if any employee already exists
    const { count: empCount } = await supabaseAdmin
      .from('employees')
      .select('id', { count: 'exact', head: true })

    if ((empCount ?? 0) > 0) {
      return jsonResponse({ status: 'already_seeded', message: 'Database already populated.' }, 200)
    }

    // 1. Departments
    const { data: depts, error: deptErr } = await supabaseAdmin
      .from('departments')
      .insert([
        { name: 'People & Operations', code: 'OPS', description: 'Workforce operations, governance, and compliance' },
        { name: 'Engineering', code: 'ENG', description: 'Core platform architecture, security, and cloud delivery' },
        { name: 'Product & Design', code: 'PRD', description: 'Product strategy, UX architecture, and visual systems' },
        { name: 'Revenue & Growth', code: 'REV', description: 'Enterprise accounts, partnerships, and customer success' },
      ])
      .select('*')

    if (deptErr || !depts) throw deptErr ?? new Error('Failed inserting departments')
    const deptByCode = Object.fromEntries(depts.map((d) => [d.code, d.id]))

    // 2. Teams
    const { data: teams, error: teamErr } = await supabaseAdmin
      .from('teams')
      .insert([
        { department_id: deptByCode['OPS'], name: 'Talent & Workplace', description: 'Employee lifecycle & operations' },
        { department_id: deptByCode['ENG'], name: 'Core Platform', description: 'Realtime infrastructure & web apps' },
        { department_id: deptByCode['ENG'], name: 'Cloud & Security', description: 'Zero-trust infrastructure & SRE' },
        { department_id: deptByCode['PRD'], name: 'Product Experience', description: 'Design systems & user research' },
        { department_id: deptByCode['REV'], name: 'Enterprise Solutions', description: 'Strategic B2B accounts' },
        { department_id: deptByCode['REV'], name: 'Customer Success', description: 'Onboarding & enterprise adoption' },
      ])
      .select('*')

    if (teamErr || !teams) throw teamErr ?? new Error('Failed inserting teams')
    const teamByName = Object.fromEntries(teams.map((t) => [t.name, t.id]))

    // 3. Seed Employees & Auth Users
    const demoPassword = 'VarTa@2026!'
    const seedEmployees = [
      {
        employee_code: 'EMP001',
        full_name: 'Rahul Sharma',
        email: 'rahul.sharma@varta.io',
        phone: '+91 98201 44101',
        department_id: deptByCode['OPS'],
        team_id: teamByName['Talent & Workplace'],
        designation: 'VP of Operations & Super Admin',
        intended_role: 'super_admin',
        status: 'active',
        date_of_joining: '2023-02-14',
        bio: 'Oversees enterprise governance, workforce onboarding, and compliance reporting across VarTa.',
        createAuth: true,
      },
      {
        employee_code: 'EMP002',
        full_name: 'Amit Kumar',
        email: 'amit.kumar@varta.io',
        phone: '+91 98201 44102',
        department_id: deptByCode['ENG'],
        team_id: teamByName['Core Platform'],
        designation: 'Engineering Manager',
        intended_role: 'organizer',
        status: 'active',
        date_of_joining: '2023-05-08',
        bio: 'Leads Core Platform sprints, architecture reviews, and live reliability standups.',
        createAuth: true,
      },
      {
        employee_code: 'EMP003',
        full_name: 'Priya Singh',
        email: 'priya.singh@varta.io',
        phone: '+91 98201 44103',
        department_id: deptByCode['PRD'],
        team_id: teamByName['Product Experience'],
        designation: 'Head of Product Design',
        intended_role: 'organizer',
        status: 'active',
        date_of_joining: '2023-06-21',
        bio: 'Drives enterprise UX standards, design critiques, and cross-functional discovery rituals.',
        createAuth: true,
      },
      {
        employee_code: 'EMP004',
        full_name: 'Neha Verma',
        email: 'neha.verma@varta.io',
        phone: '+91 98201 44104',
        department_id: deptByCode['ENG'],
        team_id: teamByName['Core Platform'],
        designation: 'Senior Frontend Architect',
        intended_role: 'employee',
        status: 'active',
        date_of_joining: '2024-01-10',
        bio: 'Specializes in real-time WebRTC interfaces, design systems, and low-latency state sync.',
        createAuth: true,
      },
      {
        employee_code: 'EMP005',
        full_name: 'Arjun Mehta',
        email: 'arjun.mehta@varta.io',
        phone: '+91 98201 44105',
        department_id: deptByCode['ENG'],
        team_id: teamByName['Cloud & Security'],
        designation: 'Staff Infrastructure Engineer',
        intended_role: 'employee',
        status: 'active',
        date_of_joining: '2023-09-18',
        bio: 'Focuses on Postgres RLS policy hardening, multi-region edge compute, and SOC2 telemetry.',
        createAuth: true,
      },
      {
        employee_code: 'EMP006',
        full_name: 'Ananya Iyer',
        email: 'ananya.iyer@varta.io',
        phone: '+91 98201 44106',
        department_id: deptByCode['PRD'],
        team_id: teamByName['Product Experience'],
        designation: 'Lead UX Researcher',
        intended_role: 'employee',
        status: 'active',
        date_of_joining: '2024-03-04',
        bio: 'Conducts enterprise usability testing and workflow telemetry analysis for meeting tools.',
        createAuth: true,
      },
      {
        employee_code: 'EMP007',
        full_name: 'Vikram Patel',
        email: 'vikram.patel@varta.io',
        phone: '+91 98201 44107',
        department_id: deptByCode['REV'],
        team_id: teamByName['Enterprise Solutions'],
        designation: 'Enterprise Account Director',
        intended_role: 'employee',
        status: 'active',
        date_of_joining: '2024-04-15',
        bio: 'Partners with Fortune 500 leadership teams on enterprise workspace rollouts.',
        createAuth: true,
      },
      {
        employee_code: 'EMP008',
        full_name: 'Sanya Kapoor',
        email: 'sanya.kapoor@varta.io',
        phone: '+91 98201 44108',
        department_id: deptByCode['REV'],
        team_id: teamByName['Customer Success'],
        designation: 'Customer Success Lead',
        intended_role: 'employee',
        status: 'active',
        date_of_joining: '2024-07-01',
        bio: 'Guides customer onboarding cohorts, executive QBRs, and adoption health reviews.',
        createAuth: true,
      },
      {
        employee_code: 'EMP009',
        full_name: 'Kabir Malhotra',
        email: 'kabir.malhotra@varta.io',
        phone: '+91 98201 44109',
        department_id: deptByCode['ENG'],
        team_id: teamByName['Cloud & Security'],
        designation: 'Site Reliability Engineer',
        intended_role: 'employee',
        status: 'invited',
        date_of_joining: '2026-11-26',
        bio: 'Incoming SRE focusing on observability pipelines and incident automation.',
        createAuth: false,
      },
      {
        employee_code: 'EMP010',
        full_name: 'Meera Nair',
        email: 'meera.nair@varta.io',
        phone: '+91 98201 44110',
        department_id: deptByCode['PRD'],
        team_id: teamByName['Product Experience'],
        designation: 'Senior Product Designer',
        intended_role: 'employee',
        status: 'invited',
        date_of_joining: '2026-11-26',
        bio: 'Joining Product Experience to lead motion systems and calendar workflows.',
        createAuth: false,
      },
    ]

    const empByCode: Record<string, string> = {}

    for (const emp of seedEmployees) {
      let authUserId: string | null = null
      if (emp.createAuth) {
        const { data: uData, error: uErr } = await supabaseAdmin.auth.admin.createUser({
          email: emp.email,
          password: demoPassword,
          email_confirm: true,
          app_metadata: { role: emp.intended_role, employee_code: emp.employee_code },
          user_metadata: { full_name: emp.full_name, employee_code: emp.employee_code },
        })
        if (uErr || !uData.user) throw uErr ?? new Error(`Failed creating auth user ${emp.email}`)
        authUserId = uData.user.id
      }

      const { data: insertedEmp, error: empErr } = await supabaseAdmin
        .from('employees')
        .insert({
          auth_user_id: authUserId,
          employee_code: emp.employee_code,
          full_name: emp.full_name,
          email: emp.email,
          phone: emp.phone,
          department_id: emp.department_id,
          team_id: emp.team_id,
          designation: emp.designation,
          bio: emp.bio,
          status: emp.status,
          intended_role: emp.intended_role,
          date_of_joining: emp.date_of_joining,
          registered_at: emp.createAuth ? new Date().toISOString() : null,
        })
        .select('*')
        .single()

      if (empErr || !insertedEmp) throw empErr ?? new Error(`Failed inserting ${emp.employee_code}`)
      empByCode[emp.employee_code] = insertedEmp.id

      if (authUserId) {
        await supabaseAdmin.auth.admin.updateUserById(authUserId, {
          app_metadata: {
            role: emp.intended_role,
            employee_id: insertedEmp.id,
            employee_code: emp.employee_code,
          },
        })
        await supabaseAdmin.from('user_roles').insert({
          user_id: authUserId,
          employee_id: insertedEmp.id,
          role: emp.intended_role,
        })
      }
    }

    // Set department heads & team leads
    await supabaseAdmin.from('departments').update({ head_employee_id: empByCode['EMP001'] }).eq('id', deptByCode['OPS'])
    await supabaseAdmin.from('departments').update({ head_employee_id: empByCode['EMP002'] }).eq('id', deptByCode['ENG'])
    await supabaseAdmin.from('departments').update({ head_employee_id: empByCode['EMP003'] }).eq('id', deptByCode['PRD'])
    await supabaseAdmin.from('departments').update({ head_employee_id: empByCode['EMP007'] }).eq('id', deptByCode['REV'])

    await supabaseAdmin.from('teams').update({ lead_employee_id: empByCode['EMP002'] }).eq('id', teamByName['Core Platform'])
    await supabaseAdmin.from('teams').update({ lead_employee_id: empByCode['EMP005'] }).eq('id', teamByName['Cloud & Security'])
    await supabaseAdmin.from('teams').update({ lead_employee_id: empByCode['EMP003'] }).eq('id', teamByName['Product Experience'])

    // 4. Meetings relative to current timestamp
    const now = Date.now()
    const mins = (m: number) => new Date(now + m * 60_000).toISOString()
    const hrs = (h: number) => new Date(now + h * 3_600_000).toISOString()
    const days = (d: number) => new Date(now + d * 86_400_000).toISOString()

    const { data: meetings, error: mtErr } = await supabaseAdmin
      .from('meetings')
      .insert([
        {
          meeting_code: 'VRT-4102',
          title: 'Q4 Architecture & Platform Sync',
          description: 'Live cross-team engineering review covering Supabase RLS scaling, WebRTC mesh topology, and latency targets.',
          organizer_id: empByCode['EMP002'],
          department_id: deptByCode['ENG'],
          team_id: teamByName['Core Platform'],
          scheduled_start: mins(-15),
          scheduled_end: mins(45),
          duration_minutes: 60,
          status: 'live',
          waiting_room_enabled: false,
          is_locked: true,
          actual_started_at: mins(-15),
        },
        {
          meeting_code: 'VRT-4108',
          title: 'Design System Review — Sprint 14',
          description: 'Walkthrough of updated dark charcoal UI tokens, motion curves, and employee directory accessibility.',
          organizer_id: empByCode['EMP003'],
          department_id: deptByCode['PRD'],
          team_id: teamByName['Product Experience'],
          scheduled_start: hrs(2),
          scheduled_end: hrs(3),
          duration_minutes: 60,
          status: 'scheduled',
          waiting_room_enabled: true,
          is_locked: true,
        },
        {
          meeting_code: 'VRT-4115',
          title: 'Enterprise Security & Compliance Briefing',
          description: 'Mandatory briefing on zero-trust identity verification, audit logging, and attendance governance.',
          organizer_id: empByCode['EMP001'],
          department_id: deptByCode['OPS'],
          scheduled_start: days(1),
          scheduled_end: new Date(new Date(days(1)).getTime() + 45 * 60_000).toISOString(),
          duration_minutes: 45,
          status: 'scheduled',
          waiting_room_enabled: false,
          is_locked: true,
        },
        {
          meeting_code: 'VRT-4122',
          title: 'Revenue Pipeline & Enterprise Rollout',
          description: 'Sync between Engineering Leadership and Revenue teams on upcoming enterprise deployments.',
          organizer_id: empByCode['EMP002'],
          department_id: deptByCode['REV'],
          scheduled_start: days(3),
          scheduled_end: new Date(new Date(days(3)).getTime() + 30 * 60_000).toISOString(),
          duration_minutes: 30,
          status: 'scheduled',
          waiting_room_enabled: false,
          is_locked: true,
        },
        {
          meeting_code: 'VRT-4088',
          title: 'Weekly Engineering All-Hands',
          description: 'Weekly engineering checkpoint covering release velocity, incidents, and sprint commitments.',
          organizer_id: empByCode['EMP002'],
          department_id: deptByCode['ENG'],
          scheduled_start: days(-1),
          scheduled_end: new Date(new Date(days(-1)).getTime() + 45 * 60_000).toISOString(),
          duration_minutes: 45,
          status: 'completed',
          waiting_room_enabled: false,
          is_locked: true,
          actual_started_at: days(-1),
          actual_ended_at: new Date(new Date(days(-1)).getTime() + 43 * 60_000).toISOString(),
        },
        {
          meeting_code: 'VRT-4075',
          title: 'Product Roadmap & UX Research Readout',
          description: 'Synthesis of Q4 enterprise customer interviews and prioritized roadmap bets.',
          organizer_id: empByCode['EMP003'],
          department_id: deptByCode['PRD'],
          scheduled_start: days(-3),
          scheduled_end: new Date(new Date(days(-3)).getTime() + 60 * 60_000).toISOString(),
          duration_minutes: 60,
          status: 'completed',
          waiting_room_enabled: false,
          is_locked: true,
          actual_started_at: days(-3),
          actual_ended_at: new Date(new Date(days(-3)).getTime() + 58 * 60_000).toISOString(),
        },
        {
          meeting_code: 'VRT-4091',
          title: 'Legacy Tooling Deprecation Sync',
          description: 'Cancelled after async sign-off in engineering channel.',
          organizer_id: empByCode['EMP002'],
          department_id: deptByCode['ENG'],
          scheduled_start: hrs(5),
          scheduled_end: new Date(new Date(hrs(5)).getTime() + 30 * 60_000).toISOString(),
          duration_minutes: 30,
          status: 'cancelled',
          waiting_room_enabled: false,
          is_locked: true,
        },
      ])
      .select('*')

    if (mtErr || !meetings) throw mtErr ?? new Error('Failed inserting meetings')
    const mtByCode = Object.fromEntries(meetings.map((m) => [m.meeting_code, m.id]))

    // 5. Participants
    const participantsPayload = [
      // Live meeting VRT-4102
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP002'], role_in_meeting: 'organizer', admission_status: 'admitted' },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP001'], role_in_meeting: 'participant', admission_status: 'admitted' },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP003'], role_in_meeting: 'participant', admission_status: 'admitted' },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP004'], role_in_meeting: 'participant', admission_status: 'invited' },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP005'], role_in_meeting: 'participant', admission_status: 'waiting' },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP006'], role_in_meeting: 'participant', admission_status: 'invited' },

      // Upcoming VRT-4108
      { meeting_id: mtByCode['VRT-4108'], employee_id: empByCode['EMP003'], role_in_meeting: 'organizer', admission_status: 'admitted' },
      { meeting_id: mtByCode['VRT-4108'], employee_id: empByCode['EMP004'], role_in_meeting: 'participant', admission_status: 'invited' },
      { meeting_id: mtByCode['VRT-4108'], employee_id: empByCode['EMP006'], role_in_meeting: 'participant', admission_status: 'invited' },

      // Upcoming VRT-4115 (All active employees)
      ...['EMP001', 'EMP002', 'EMP003', 'EMP004', 'EMP005', 'EMP006', 'EMP007', 'EMP008'].map((code) => ({
        meeting_id: mtByCode['VRT-4115'],
        employee_id: empByCode[code],
        role_in_meeting: code === 'EMP001' ? 'organizer' : 'participant',
        admission_status: code === 'EMP001' ? 'admitted' : 'invited',
      })),

      // Upcoming VRT-4122
      { meeting_id: mtByCode['VRT-4122'], employee_id: empByCode['EMP002'], role_in_meeting: 'organizer', admission_status: 'admitted' },
      { meeting_id: mtByCode['VRT-4122'], employee_id: empByCode['EMP007'], role_in_meeting: 'participant', admission_status: 'invited' },
      { meeting_id: mtByCode['VRT-4122'], employee_id: empByCode['EMP008'], role_in_meeting: 'participant', admission_status: 'invited' },

      // Completed VRT-4088
      ...['EMP002', 'EMP001', 'EMP003', 'EMP004', 'EMP005', 'EMP006'].map((code) => ({
        meeting_id: mtByCode['VRT-4088'],
        employee_id: empByCode[code],
        role_in_meeting: code === 'EMP002' ? 'organizer' : 'participant',
        admission_status: code === 'EMP006' ? 'invited' : 'admitted',
      })),

      // Completed VRT-4075
      ...['EMP003', 'EMP004', 'EMP006', 'EMP007', 'EMP008'].map((code) => ({
        meeting_id: mtByCode['VRT-4075'],
        employee_id: empByCode[code],
        role_in_meeting: code === 'EMP003' ? 'organizer' : 'participant',
        admission_status: code === 'EMP007' ? 'invited' : 'admitted',
      })),

      // Cancelled VRT-4091
      { meeting_id: mtByCode['VRT-4091'], employee_id: empByCode['EMP002'], role_in_meeting: 'organizer', admission_status: 'admitted' },
      { meeting_id: mtByCode['VRT-4091'], employee_id: empByCode['EMP004'], role_in_meeting: 'participant', admission_status: 'invited' },
      { meeting_id: mtByCode['VRT-4091'], employee_id: empByCode['EMP005'], role_in_meeting: 'participant', admission_status: 'invited' },
    ]

    await supabaseAdmin.from('meeting_participants').insert(participantsPayload)

    // 6. Attendance rows (Live + Completed)
    await supabaseAdmin.from('attendance').insert([
      // Live meeting VRT-4102
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP001'], status: 'present', join_time: mins(-14), last_heartbeat_at: mins(-1), total_duration_seconds: 840, verified_entry: true },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP002'], status: 'present', join_time: mins(-15), last_heartbeat_at: mins(-1), total_duration_seconds: 900, verified_entry: true },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP003'], status: 'present', join_time: mins(-12), last_heartbeat_at: mins(-1), total_duration_seconds: 720, verified_entry: true },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP004'], status: 'absent', verified_entry: false, total_duration_seconds: 0 },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP005'], status: 'waiting', verified_entry: false, total_duration_seconds: 0 },
      { meeting_id: mtByCode['VRT-4102'], employee_id: empByCode['EMP006'], status: 'absent', verified_entry: false, total_duration_seconds: 0 },

      // Completed VRT-4088
      { meeting_id: mtByCode['VRT-4088'], employee_id: empByCode['EMP001'], status: 'present', join_time: days(-1), leave_time: new Date(new Date(days(-1)).getTime() + 42 * 60_000).toISOString(), total_duration_seconds: 2520, verified_entry: true },
      { meeting_id: mtByCode['VRT-4088'], employee_id: empByCode['EMP002'], status: 'present', join_time: days(-1), leave_time: new Date(new Date(days(-1)).getTime() + 43 * 60_000).toISOString(), total_duration_seconds: 2580, verified_entry: true },
      { meeting_id: mtByCode['VRT-4088'], employee_id: empByCode['EMP003'], status: 'present', join_time: days(-1), leave_time: new Date(new Date(days(-1)).getTime() + 40 * 60_000).toISOString(), total_duration_seconds: 2400, verified_entry: true },
      { meeting_id: mtByCode['VRT-4088'], employee_id: empByCode['EMP004'], status: 'present', join_time: days(-1), leave_time: new Date(new Date(days(-1)).getTime() + 43 * 60_000).toISOString(), total_duration_seconds: 2580, verified_entry: true },
      { meeting_id: mtByCode['VRT-4088'], employee_id: empByCode['EMP005'], status: 'present', join_time: days(-1), leave_time: new Date(new Date(days(-1)).getTime() + 38 * 60_000).toISOString(), total_duration_seconds: 2280, verified_entry: true },
      { meeting_id: mtByCode['VRT-4088'], employee_id: empByCode['EMP006'], status: 'absent', total_duration_seconds: 0, verified_entry: false },

      // Completed VRT-4075
      { meeting_id: mtByCode['VRT-4075'], employee_id: empByCode['EMP003'], status: 'present', join_time: days(-3), leave_time: new Date(new Date(days(-3)).getTime() + 58 * 60_000).toISOString(), total_duration_seconds: 3480, verified_entry: true },
      { meeting_id: mtByCode['VRT-4075'], employee_id: empByCode['EMP004'], status: 'present', join_time: days(-3), leave_time: new Date(new Date(days(-3)).getTime() + 55 * 60_000).toISOString(), total_duration_seconds: 3300, verified_entry: true },
      { meeting_id: mtByCode['VRT-4075'], employee_id: empByCode['EMP006'], status: 'present', join_time: days(-3), leave_time: new Date(new Date(days(-3)).getTime() + 58 * 60_000).toISOString(), total_duration_seconds: 3480, verified_entry: true },
      { meeting_id: mtByCode['VRT-4075'], employee_id: empByCode['EMP007'], status: 'absent', total_duration_seconds: 0, verified_entry: false },
      { meeting_id: mtByCode['VRT-4075'], employee_id: empByCode['EMP008'], status: 'present', join_time: days(-3), leave_time: new Date(new Date(days(-3)).getTime() + 50 * 60_000).toISOString(), total_duration_seconds: 3000, verified_entry: true },
    ])

    // 7. Agendas
    await supabaseAdmin.from('meeting_agenda').insert([
      { meeting_id: mtByCode['VRT-4102'], position: 1, title: 'WebRTC Mesh Signaling Latency Benchmarks', duration_minutes: 15, presenter_name: 'Amit Kumar', is_completed: true },
      { meeting_id: mtByCode['VRT-4102'], position: 2, title: 'Postgres RLS Policy & Attendance Audit Review', duration_minutes: 25, presenter_name: 'Rahul Sharma', is_completed: false },
      { meeting_id: mtByCode['VRT-4102'], position: 3, title: 'Sprint 15 Release Readiness & Action Items', duration_minutes: 20, presenter_name: 'Priya Singh', is_completed: false },
      { meeting_id: mtByCode['VRT-4108'], position: 1, title: 'Dark Charcoal Card Tokens & Motion Specs', duration_minutes: 30, presenter_name: 'Priya Singh', is_completed: false },
      { meeting_id: mtByCode['VRT-4108'], position: 2, title: 'Employee Directory & Calendar Accessibility', duration_minutes: 30, presenter_name: 'Ananya Iyer', is_completed: false },
    ])

    // 8. Chat Messages in live meeting
    await supabaseAdmin.from('meeting_messages').insert([
      { meeting_id: mtByCode['VRT-4102'], sender_employee_id: empByCode['EMP002'], sender_name: 'Amit Kumar', sender_code: 'EMP002', content: 'Welcome everyone! Agenda item 1 is underway — live attendance tracking is active.', message_type: 'text' },
      { meeting_id: mtByCode['VRT-4102'], sender_employee_id: empByCode['EMP001'], sender_name: 'Rahul Sharma', sender_code: 'EMP001', content: 'Confirmed — seeing real-time entry statuses sync cleanly in the attendance panel.', message_type: 'text' },
      { meeting_id: mtByCode['VRT-4102'], sender_employee_id: empByCode['EMP003'], sender_name: 'Priya Singh', sender_code: 'EMP003', content: 'Sharing the updated design specs right after the RLS review.', message_type: 'text' },
    ])

    // 9. Announcements
    await supabaseAdmin.from('announcements').insert([
      {
        title: 'Verified Attendance Policy Live Across All Meetings',
        content: 'Employees are marked Present only after passing invite verification and entering the live meeting room. Organizers can export CSV/Excel attendance logs right after each call.',
        priority: 'important',
        author_employee_id: empByCode['EMP001'],
      },
      {
        title: 'Q4 Security & Compliance Briefing Tomorrow',
        content: 'All active team members are invited to tomorrow’s 45-minute briefing hosted by VP of Operations. Please ensure your camera and microphone permissions are enabled.',
        priority: 'info',
        author_employee_id: empByCode['EMP001'],
      },
      {
        title: 'Two New Hires Ready for Onboarding Verification',
        content: 'EMP009 (Kabir Malhotra) and EMP010 (Meera Nair) have pre-approved invitations queued for self-service registration.',
        priority: 'info',
        author_employee_id: empByCode['EMP001'],
      },
    ])

    // 10. Activity Logs & Notifications
    await supabaseAdmin.from('meeting_activity_logs').insert([
      { meeting_id: mtByCode['VRT-4102'], actor_employee_id: empByCode['EMP002'], action: 'meeting_started', details: { title: 'Q4 Architecture & Platform Sync' } },
      { meeting_id: mtByCode['VRT-4102'], actor_employee_id: empByCode['EMP001'], action: 'joined_meeting', details: { employee_code: 'EMP001', full_name: 'Rahul Sharma' } },
      { meeting_id: mtByCode['VRT-4102'], actor_employee_id: empByCode['EMP003'], action: 'joined_meeting', details: { employee_code: 'EMP003', full_name: 'Priya Singh' } },
      { meeting_id: mtByCode['VRT-4088'], actor_employee_id: empByCode['EMP002'], action: 'meeting_ended', details: { title: 'Weekly Engineering All-Hands' } },
    ])

    await supabaseAdmin.from('notifications').insert([
      {
        recipient_employee_id: empByCode['EMP004'],
        meeting_id: mtByCode['VRT-4102'],
        type: 'meeting_started',
        title: 'Meeting is Live Now',
        message: '"Q4 Architecture & Platform Sync" started 15 minutes ago. Join now to avoid being marked Absent.',
      },
      {
        recipient_employee_id: empByCode['EMP004'],
        meeting_id: mtByCode['VRT-4108'],
        type: 'meeting_invited',
        title: 'Upcoming Meeting Today',
        message: 'Priya Singh invited you to "Design System Review — Sprint 14".',
      },
      {
        recipient_employee_id: empByCode['EMP002'],
        meeting_id: mtByCode['VRT-4102'],
        type: 'waiting_room',
        title: 'Participant Waiting',
        message: 'Arjun Mehta (EMP005) is waiting to join "Q4 Architecture & Platform Sync".',
      },
    ])

    return jsonResponse({ status: 'seeded', employees: seedEmployees.length, meetings: meetings.length })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Seed error' }, 500)
  }
})
