# VarTa — Lightweight Real-Time Video Meeting Platform

**VarTa** is a Google-Meet-style video meeting platform built with **React 19, TypeScript, Vite, Tailwind CSS v4, LiveKit Cloud**, and **Supabase** (Auth, PostgreSQL + RLS, Realtime, Vault, and Deno Edge Functions).

## Core Features

- **Minimal Public Landing Page (`/`)**: Quick access to **Create Meeting** (redirects unauthenticated visitors to login and returns automatically), **Join Meeting** by link or meeting code, **Login**, and **Sign Up**.
- **Supabase Authentication & Recovery**:
  - Full account registration (`/register`, `/signup`), login (`/login`), and password reset via recovery code or link (`/reset-password`), while preserving meeting invite redirect URLs (`?redirect=...`).
  - Automatic `public.profiles` sync from `auth.users` via Postgres trigger (`private.handle_new_auth_user()`).
- **Meeting Creation & Automated Email Invitations (`/create-meeting`)**:
  - Create instant or scheduled meetings with optional Waiting Room admission control.
  - Generate unique `vrt-xxxx-xxxx` room codes and HMAC-protected invitation share links (`?invite=...`) or per-recipient personal invite tokens (`?token=...`).
  - Automatic HTML email delivery via Gmail SMTP / Supabase Vault (`_shared/mailer.ts`) or Resend fallback, plus WhatsApp & clipboard sharing.
- **Guest & Authenticated Joining (`/meeting/:id`)**:
  - Invited guests can join directly with their Full Name (required) and optional Email without creating an account, or sign in / register and return straight to the meeting room.
  - Bare meeting codes without organizer status, an invite email match, `?token=`, or `?invite=` are blocked server-side.
- **LiveKit Cloud Video & Audio (`LiveKitRoomView.tsx`)**:
  - Live camera grid, screen-share spotlight, microphone/camera/screen toggles, waiting-room admit/remove controls, participant leave tracking, and organizer-only **End Meeting** (`DeleteRoom`).

---

## Repository Structure

```text
VarTa/
├── .env.example                       # Public Vite environment variable template
├── .gitignore                         # Ignores node_modules, dist, local env files, caches
├── index.html                         # Root HTML entry loading fonts and /src/main.tsx
├── package.json                       # Frontend dependencies (React 19, LiveKit SDK, Supabase)
├── tsconfig.json                      # Frontend TypeScript config
├── vercel.json                        # SPA rewrite routing for Vercel deployments
├── vite.config.ts                     # Vite + React + Tailwind CSS v4 config
├── README.md                          # Project overview, setup, and deployment guide
├── PROJECT_DOCUMENTATION.md           # Full architecture, schema, and security reference
├── FILE_CONNECTIONS.md                # End-to-end file & Edge Function data flow
├── src/
│   ├── main.tsx                       # Application bootstrap
│   ├── App.tsx                        # Router & auth/guest route definitions
│   ├── index.css                      # Tailwind v4 setup and VarTa surface styles
│   ├── types/database.ts              # Shared TypeScript interfaces for tables & LiveKit state
│   ├── contexts/
│   │   ├── AuthContext.tsx            # Auth session + `profiles` loader
│   │   └── ToastContext.tsx           # Toast notifications
│   ├── lib/
│   │   ├── supabase.ts                # Browser Supabase client + `invokeEdgeFunction()`
│   │   └── utils.ts                   # Date formatting, URL sanitization, meeting link parsing
│   ├── components/
│   │   ├── layout/AppShell.tsx        # Authenticated header navigation shell
│   │   ├── meeting/LiveKitRoomView.tsx# Official LiveKit room & media controls
│   │   └── ui/                        # Reusable UI primitives (`Avatar`, `Modal`, badges, motion)
│   └── pages/
│       ├── HomePage.tsx               # Public landing page
│       ├── LoginPage.tsx              # Sign-in + forgot password trigger (`auth-email`)
│       ├── RegisterPage.tsx           # Sign-up preserving `?redirect=`
│       ├── ResetPasswordPage.tsx      # Recovery code / token password update
│       ├── DashboardPage.tsx          # User dashboard (`/dashboard`)
│       ├── CreateMeetingPage.tsx      # Create instant/scheduled meetings + send invites
│       ├── MyMeetingsPage.tsx         # Manage hosted & invited meetings (`/my-meetings`)
│       └── MeetingRoomPage.tsx        # Pre-join gate, waiting room, and LiveKit room stage
└── supabase/
    ├── migrations/                    # Ordered PostgreSQL migration history
    │   ├── 20261126*–20261127*        # Legacy initial schema & runtime SMTP vault setup
    │   ├── 20261128000001_varta_clean_livekit_schema.sql
    │   └── 20261128000002_sync_vault_smtp_from_backup.sql
    └── functions/
        ├── _shared/mailer.ts          # Shared SMTP (Vault) + Resend email helper
        ├── auth-email/index.ts        # Password recovery link & OTP email dispatcher
        ├── get-livekit-token/         # LiveKit JWT minting, waiting room & RoomService controls
        └── meeting-invitations/       # Meeting creation, HMAC share links & invite dispatch
```

---

## Environment & Secrets Setup

### Frontend (`.env.local` / Vercel)
```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
```

### Supabase Edge Functions Secrets
Never expose any of these values in frontend code:
- `LIVEKIT_URL` — LiveKit Cloud WebSocket URL (`wss://...livekit.cloud`)
- `LIVEKIT_API_KEY` — LiveKit Cloud API key
- `LIVEKIT_API_SECRET` — LiveKit Cloud API secret
- Email delivery uses `private.runtime_mail_config` + Supabase Vault (`get_smtp_runtime_config()`), with optional `SMTP_*`, `RESEND_API_KEY`, and `APP_URL` environment overrides.

---

## Local Development & Verification

```bash
npm install
npm run dev
```

Verify types and build:
```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.json
npx tsc --noEmit -p supabase/functions/tsconfig.json
npm run build
```

Deploy Supabase Edge Functions (with JWT gateway disabled so backend validates organizer JWTs and guest tokens explicitly):
```bash
npx supabase functions deploy get-livekit-token --no-verify-jwt
npx supabase functions deploy meeting-invitations --no-verify-jwt
npx supabase functions deploy auth-email --no-verify-jwt
```
