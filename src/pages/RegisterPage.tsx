/**
 * File: src/pages/RegisterPage.tsx
 * Purpose: Open account registration page (`Full Name`, `Email`, `Password`, `Confirm Password`)
 *   for VARTA Meeting Organizers and Participants. Automatically creates `public.profiles`
 *   and preserves `?redirect=` links so invited users return straight to their original meeting.
 * Connected files:
 *   - `src/App.tsx` (routes `/register` and `/signup`)
 *   - `src/contexts/AuthContext.tsx` (`refreshProfile()`)
 *   - `src/pages/LoginPage.tsx` (linked for existing accounts)
 */
import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldAlert,
  User,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generateStrongPassword, sanitizeRedirectPath } from '../lib/utils'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

export function RegisterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refreshProfile } = useAuth()
  const { toast } = useToast()

  const redirectParam = searchParams.get('redirect')
  const redirectTarget = sanitizeRedirectPath(redirectParam, '/dashboard')
  const loginHref = redirectParam
    ? `/login?redirect=${encodeURIComponent(redirectParam)}`
    : '/login'

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [copiedPassword, setCopiedPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState(false)

  const handleGeneratePassword = () => {
    const generated = generateStrongPassword(12)
    setPassword(generated)
    setConfirmPassword(generated)
    setShowPassword(true)
    setCopiedPassword(false)
  }

  const handleCopyPassword = async () => {
    if (!password) return
    try {
      await navigator.clipboard.writeText(password)
      setCopiedPassword(true)
      setTimeout(() => setCopiedPassword(false), 2000)
    } catch {
      toast({ type: 'error', title: 'Clipboard blocked', description: 'Copy the password manually.' })
    }
  }

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const cleanName = fullName.trim()
    const cleanEmail = email.trim().toLowerCase()

    if (!cleanName) {
      setError('Full Name is required.')
      return
    }
    if (!cleanEmail) {
      setError('Email Address is required.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const emailRedirectUrl = `${window.location.origin}${redirectTarget}`
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { full_name: cleanName },
          emailRedirectTo: emailRedirectUrl,
        },
      })

      if (signUpErr) {
        setError(signUpErr.message)
        return
      }

      if (data.session && data.user) {
        await supabase.from('profiles').upsert(
          {
            id: data.user.id,
            full_name: cleanName,
            email: cleanEmail,
          },
          { onConflict: 'id' }
        )
        await refreshProfile()
        toast({
          type: 'success',
          title: 'Account Created',
          description: redirectParam ? 'Redirecting you to your meeting...' : 'Welcome to VARTA!',
        })
        navigate(redirectTarget, { replace: true })
        return
      }

      setPendingConfirmation(true)
      toast({
        type: 'info',
        title: 'Confirm Your Email',
        description: `We sent a confirmation link to ${cleanEmail}.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen varta-canvas flex items-center justify-center p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md varta-card rounded-[28px] p-8 sm:p-9"
      >
        <div className="mb-6">
          <Link to={loginHref} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6E748C] hover:text-[#151722] mb-4">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Login
          </Link>

          <div className="flex items-center gap-2.5 mb-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center text-white font-display font-bold">
              V
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#4D4CEF]/10 text-[#4D4CEF] border border-[#4D4CEF]/20">
              Create VARTA Account
            </span>
          </div>

          <h1 className="font-display text-2xl font-bold text-[#151722] tracking-tight">Sign Up</h1>
          <p className="text-xs text-[#6E748C] mt-1">
            {redirectParam
              ? 'Create your account to continue into the meeting.'
              : 'Create an account to host and manage VARTA video meetings.'}
          </p>
        </div>

        {pendingConfirmation ? (
          <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-3">
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              Account Created — Verify Email
            </div>
            <p className="text-xs text-emerald-800 leading-relaxed">
              Check <strong>{email.trim().toLowerCase()}</strong> for your verification link. Once verified, you will be
              redirected back to VARTA automatically.
            </p>
            <Link
              to={loginHref}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#4D4CEF] hover:underline"
            >
              Continue to Login →
            </Link>
          </div>
        ) : (
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Full Name</label>
              <div className="relative">
                <User className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Johnson"
                  className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                />
              </div>
            </div>

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
                <div className="flex items-center gap-3">
                  {password && (
                    <button
                      type="button"
                      onClick={handleCopyPassword}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#454A62] hover:text-[#151722]"
                    >
                      {copiedPassword ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleGeneratePassword}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4D4CEF] hover:underline"
                  >
                    <KeyRound className="h-3 w-3" />
                    Generate Strong Password
                  </button>
                </div>
              </div>
              <div className="relative">
                <Lock className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
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

            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_12px_26px_-8px_rgba(21,22,28,0.45)] transition-all cursor-pointer"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        )}

        <div className="mt-5 pt-5 border-t border-[#EEF0F7] flex items-center justify-between text-xs gap-2">
          <span className="text-[#6E748C]">Already have an account?</span>
          <Link to={loginHref} className="font-semibold text-[#4D4CEF] hover:underline shrink-0">
            Login →
          </Link>
        </div>
      </motion.div>
    </div>
  )
}
