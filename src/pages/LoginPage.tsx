/**
 * File: src/pages/LoginPage.tsx
 * Purpose: Authenticates existing employees, Meeting Organizers, and Super Admins via Supabase Auth
 *   in the clean Lavender-Alabaster & Royal Indigo studio aesthetic.
 * Why required: Entry point for all active accounts; enforces credential sign-in before `AuthContext` loads
 *   the user's `public.employees` record and `public.user_roles` role.
 * Connected files:
 *   - `src/App.tsx` (renders `/login` inside `PublicOnlyRoute`)
 *   - `src/lib/supabase.ts` (`supabase.auth.signInWithPassword`)
 *   - `src/contexts/AuthContext.tsx` (`refreshProfile()` resolves employee & role immediately post-login)
 *   - `src/contexts/ToastContext.tsx` (`useToast`)
 *   - `src/pages/RegisterPage.tsx` (linked via `/register` for first-time invited employees)
 * Data flow: Submits email/password -> Supabase Auth verifies JWT -> `refreshProfile()` loads employee
 *   and role -> redirects to `/dashboard`. Deactivated employees are rejected by `AuthContext`.
 * Impact if modified/removed: Users cannot sign into the platform.
 */
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Lock,
  Mail,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Video,
  Users,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
} from 'lucide-react'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

export function LoginPage() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const { toast } = useToast()
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSentMessage, setForgotSentMessage] = useState<string | null>(null)

  /**
   * Authenticates the user with Supabase Auth and hydrates `AuthContext` before navigating
   * to `/dashboard`, preventing any race condition with `ProtectedRoute`.
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (signInErr) {
        setError(signInErr.message)
        return
      }

      await refreshProfile()
      toast({
        type: 'success',
        title: 'Signed in to VarTa',
        description: 'Loading your role-verified enterprise workspace...',
      })
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setForgotSentMessage(null)
    setForgotLoading(true)
    try {
      const cleanEmail = forgotEmail.trim().toLowerCase()
      const res = await invokeEdgeFunction<{ ok: boolean; message?: string }>(
        'employee-registration',
        { action: 'request_password_reset', email: cleanEmail },
        false
      )
      const msg =
        res?.message ||
        'A password reset link and one-time recovery code have been sent to your official email address.'
      setForgotSentMessage(msg)
      toast({
        type: 'success',
        title: 'Reset Instructions Sent',
        description: `Check ${cleanEmail} for your password reset link or OTP code.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen varta-canvas flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl grid lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Studio Brand Showcase */}
        <motion.div
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-6 varta-card rounded-[28px] p-8 sm:p-10 flex flex-col justify-between relative overflow-hidden"
        >
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#9C65E5]/12 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-[#4D4CEF]/10 blur-3xl pointer-events-none" />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-3 mb-8">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center shadow-[0_12px_24px_-6px_rgba(77,76,239,0.5)] text-white font-display font-extrabold text-xl">
                V
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-[#151722] tracking-tight">VarTa</h1>
                <p className="text-xs text-[#7D839B]">Enterprise Meeting & Workforce Platform</p>
              </div>
            </div>

            <h2 className="font-display text-3xl sm:text-4xl font-bold text-[#151722] leading-tight tracking-tight">
              Verified meetings.
              <span className="block bg-gradient-to-r from-[#4D4CEF] via-[#6F5AE8] to-[#9C65E5] bg-clip-text text-transparent">
                Live attendance precision.
              </span>
            </h2>

            <p className="text-sm text-[#666C85] mt-4 leading-relaxed max-w-md">
              Built for modern organizations where Super Admins govern employee identities, organizers schedule locked
              sessions, and attendance updates live on room entry.
            </p>
          </div>

          {/* Signature Indigo + Violet Mini Showcase Card */}
          <div className="relative z-10 mt-8 space-y-3">
            {[
              {
                icon: ShieldCheck,
                title: 'Invite-Only Meeting Security',
                desc: 'Only selected employees & the organizer pass server-side entry verification.',
                tint: 'bg-[#4D4CEF]/10 text-[#4D4CEF]',
              },
              {
                icon: Video,
                title: 'Native WebRTC Video & Live Chat',
                desc: 'Crystal-clear peer audio/video, screen sharing, waiting rooms, and real-time chat.',
                tint: 'bg-[#9C65E5]/12 text-[#854DD1]',
              },
              {
                icon: Users,
                title: 'Real-Time Attendance & Absentee Highlights',
                desc: 'Instant Present, Absent, and Waiting telemetry with CSV & Excel reporting.',
                tint: 'bg-emerald-50 text-emerald-600',
              },
            ].map((feat) => {
              const Icon = feat.icon
              return (
                <div
                  key={feat.title}
                  className="p-3.5 rounded-2xl bg-[#F6F7FB] border border-[#E7E9F4] flex items-start gap-3"
                >
                  <div className={`p-2 rounded-xl shrink-0 ${feat.tint}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#151722]">{feat.title}</p>
                    <p className="text-xs text-[#6E748C] mt-0.5">{feat.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>

        {/* Right Crisp White Login Form */}
        <motion.div
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-6 varta-card rounded-[28px] p-8 sm:p-10 flex flex-col justify-center"
        >
          {mode === 'login' ? (
            <>
              <div className="mb-6">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#4D4CEF]/10 text-[#4D4CEF] border border-[#4D4CEF]/20 mb-3">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Company Workspace Sign In
                </span>
                <h2 className="font-display text-2xl font-bold text-[#151722] tracking-tight">Welcome back</h2>
                <p className="text-sm text-[#6E748C] mt-1">Sign in using your verified company email address.</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Company Email</label>
                  <div className="relative">
                    <Mail className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@varta.io"
                      className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="block text-xs font-semibold text-[#454A62]">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotEmail(email)
                        setForgotSentMessage(null)
                        setError(null)
                        setMode('forgot')
                      }}
                      className="text-xs font-semibold text-[#4D4CEF] hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="varta-input w-full pl-10 pr-10 py-2.5 rounded-2xl text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8D92A8] hover:text-[#151722]"
                      aria-label="Toggle password visibility"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_12px_26px_-8px_rgba(21,22,28,0.45)] transition-all hover:scale-[1.01] active:scale-[0.99]"
                >
                  {loading ? 'Signing in...' : 'Sign In to Workspace'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setForgotSentMessage(null)
                    setMode('login')
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6E748C] hover:text-[#151722] mb-4 cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to Sign In
                </button>
                <div className="block">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#4D4CEF]/10 text-[#4D4CEF] border border-[#4D4CEF]/20 mb-3">
                    <KeyRound className="h-3.5 w-3.5" />
                    Account Password Reset
                  </span>
                </div>
                <h2 className="font-display text-2xl font-bold text-[#151722] tracking-tight">Reset your password</h2>
                <p className="text-sm text-[#6E748C] mt-1">
                  Enter your official email to receive a password reset link and one-time recovery code.
                </p>
              </div>

              <form onSubmit={handleRequestReset} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Company Email</label>
                  <div className="relative">
                    <Mail className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@varta.io"
                      className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
                    {error}
                  </div>
                )}

                {forgotSentMessage && (
                  <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 space-y-2">
                    <p className="font-semibold">{forgotSentMessage}</p>
                    <Link
                      to={`/reset-password?email=${encodeURIComponent(forgotEmail.trim().toLowerCase())}`}
                      className="inline-flex items-center gap-1 font-bold text-[#4D4CEF] hover:underline"
                    >
                      Have the 6-digit code? Enter reset code →
                    </Link>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-3 px-5 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-all"
                >
                  {forgotLoading ? 'Sending Reset Link...' : 'Send Reset Link'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            </>
          )}

          <div className="mt-5 pt-5 border-t border-[#EEF0F7] flex items-center justify-between text-xs gap-2">
            <span className="text-[#6E748C]">New employee or need to generate your password?</span>
            <Link to="/register" className="font-semibold text-[#4D4CEF] hover:underline transition-colors shrink-0">
              Verify ID & Set Password →
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
