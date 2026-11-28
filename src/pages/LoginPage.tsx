/**
 * File: src/pages/LoginPage.tsx
 * Purpose: Authenticates existing VARTA users and organizers via Supabase Auth, handles Forgot Password
 *   recovery via `auth-email`, and preserves `?redirect=` meeting links across Login & Sign Up.
 * Connected files:
 *   - `src/App.tsx` (route `/login`)
 *   - `src/contexts/AuthContext.tsx` (`refreshProfile()`)
 *   - `src/pages/RegisterPage.tsx` (Sign Up with preserved `redirect`)
 *   - `supabase/functions/auth-email/index.ts` (Forgot Password recovery dispatch)
 */
import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Users,
  Video,
} from 'lucide-react'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { sanitizeRedirectPath } from '../lib/utils'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refreshProfile } = useAuth()
  const { toast } = useToast()

  const redirectParam = searchParams.get('redirect')
  const redirectTarget = sanitizeRedirectPath(redirectParam, '/dashboard')
  const registerHref = redirectParam
    ? `/register?redirect=${encodeURIComponent(redirectParam)}`
    : '/register'

  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSentMessage, setForgotSentMessage] = useState<string | null>(null)

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
        title: 'Signed in to VARTA',
        description: redirectParam ? 'Returning to your meeting...' : 'Welcome back to your meeting workspace.',
      })
      navigate(redirectTarget, { replace: true })
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
        'auth-email',
        { email: cleanEmail },
        false
      )
      setForgotSentMessage(
        res?.message || 'A password reset link and one-time recovery code have been sent to your email.'
      )
      toast({
        type: 'success',
        title: 'Reset Instructions Sent',
        description: `Check ${cleanEmail} for your reset link or OTP code.`,
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
        {/* Left Studio Brand Panel */}
        <motion.div
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-6 varta-card rounded-[28px] p-8 sm:p-10 flex flex-col justify-between relative overflow-hidden"
        >
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#9C65E5]/12 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-[#4D4CEF]/10 blur-3xl pointer-events-none" />

          <div className="relative z-10">
            <Link to="/" className="inline-flex items-center gap-3 mb-8">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center shadow-[0_12px_24px_-6px_rgba(77,76,239,0.5)] text-white font-display font-extrabold text-xl">
                V
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-[#151722] tracking-tight">VarTa</h1>
                <p className="text-xs text-[#7D839B]">Real-Time Video Meetings</p>
              </div>
            </Link>

            <h2 className="font-display text-3xl sm:text-4xl font-bold text-[#151722] leading-tight tracking-tight">
              Host meetings.
              <span className="block bg-gradient-to-r from-[#4D4CEF] via-[#6F5AE8] to-[#9C65E5] bg-clip-text text-transparent">
                Invite anyone in one click.
              </span>
            </h2>

            <p className="text-sm text-[#666C85] mt-4 leading-relaxed max-w-md">
              Sign in to create instant or scheduled meetings, email secure invitation links, and host HD calls with
              registered members and guests.
            </p>
          </div>

          <div className="relative z-10 mt-8 space-y-3">
            {[
              {
                icon: Video,
                title: 'Instant & Scheduled Meetings',
                desc: 'Create unique invitation links and launch LiveKit video rooms immediately.',
                tint: 'bg-[#4D4CEF]/10 text-[#4D4CEF]',
              },
              {
                icon: Users,
                title: 'Frictionless Guest Joining',
                desc: 'Invited participants can join with just their full name — zero signup needed.',
                tint: 'bg-[#9C65E5]/12 text-[#854DD1]',
              },
              {
                icon: ShieldCheck,
                title: 'Protected Private Invites',
                desc: 'Every meeting enforces backend invitation token checks and organizer controls.',
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

        {/* Right Crisp White Login / Forgot Password Form */}
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
                  VARTA Account Sign In
                </span>
                <h2 className="font-display text-2xl font-bold text-[#151722] tracking-tight">Welcome back</h2>
                <p className="text-sm text-[#6E748C] mt-1">
                  {redirectParam ? 'Log in to continue to your meeting.' : 'Sign in to create and manage meetings.'}
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
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
                  className="w-full py-3 px-5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_12px_26px_-8px_rgba(21,22,28,0.45)] transition-all cursor-pointer"
                >
                  {loading ? 'Signing in...' : 'Login'}
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
                  Back to Login
                </button>
                <div className="block">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#4D4CEF]/10 text-[#4D4CEF] border border-[#4D4CEF]/20 mb-3">
                    <KeyRound className="h-3.5 w-3.5" />
                    Account Password Reset
                  </span>
                </div>
                <h2 className="font-display text-2xl font-bold text-[#151722] tracking-tight">Reset your password</h2>
                <p className="text-sm text-[#6E748C] mt-1">
                  Enter your account email to receive a reset link and recovery code.
                </p>
              </div>

              <form onSubmit={handleRequestReset} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="you@example.com"
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
                      Have the recovery code? Enter code →
                    </Link>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-3 px-5 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  {forgotLoading ? 'Sending Reset Link...' : 'Send Reset Link'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            </>
          )}

          <div className="mt-5 pt-5 border-t border-[#EEF0F7] flex items-center justify-between text-xs gap-2">
            <span className="text-[#6E748C]">Don&apos;t have a VARTA account?</span>
            <Link to={registerHref} className="font-semibold text-[#4D4CEF] hover:underline shrink-0">
              Sign Up →
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
