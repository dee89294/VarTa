/**
 * File: src/pages/ResetPasswordPage.tsx
 * Purpose: Completes password recovery from either email reset links (`?token_hash=...&type=recovery`
 *   or Supabase Auth recovery session) or manual email + 6-digit recovery OTP code.
 * Connected files:
 *   - `src/App.tsx` (route `/reset-password`)
 *   - `src/pages/LoginPage.tsx` (requests reset link via `employee-registration`)
 *   - `src/lib/supabase.ts` (`supabase.auth.verifyOtp`, `supabase.auth.updateUser`)
 */
import React, { useEffect, useState } from 'react'
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
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { generateStrongPassword } from '../lib/utils'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refreshProfile } = useAuth()
  const { toast } = useToast()

  const tokenHash = searchParams.get('token_hash') ?? ''
  const linkType = searchParams.get('type') ?? 'recovery'
  const prefillEmail = searchParams.get('email') ?? ''

  const [hasRecoverySession, setHasRecoverySession] = useState(false)
  const [tokenVerified, setTokenVerified] = useState(false)
  const [email, setEmail] = useState(prefillEmail)
  const [otpCode, setOtpCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [copiedPassword, setCopiedPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && session?.user) {
        setHasRecoverySession(true)
      }
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || Boolean(nextSession?.user)) {
        setHasRecoverySession(Boolean(nextSession?.user))
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleGenerate = () => {
    const generated = generateStrongPassword(12)
    setNewPassword(generated)
    setConfirmPassword(generated)
    setShowPassword(true)
    setCopiedPassword(false)
  }

  const handleCopy = async () => {
    if (!newPassword) return
    try {
      await navigator.clipboard.writeText(newPassword)
      setCopiedPassword(true)
      setTimeout(() => setCopiedPassword(false), 2000)
    } catch {
      toast({ type: 'error', title: 'Clipboard blocked', description: 'Copy the password manually.' })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      if (tokenHash && !tokenVerified) {
        if (linkType !== 'recovery') {
          throw new Error('Invalid password recovery link type.')
        }
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        })
        if (verifyErr) throw verifyErr
        setTokenVerified(true)
      } else if (!hasRecoverySession && !tokenVerified) {
        const cleanEmail = email.trim().toLowerCase()
        const cleanOtp = otpCode.trim()
        if (!cleanEmail || !cleanOtp) {
          throw new Error('Enter your email and the 6-digit recovery code from your email, or click the link in your email.')
        }
        const { error: otpErr } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanOtp,
          type: 'recovery',
        })
        if (otpErr) throw otpErr
        setTokenVerified(true)
      }

      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
      if (updateErr) throw updateErr

      await refreshProfile()
      setCompleted(true)
      toast({
        type: 'success',
        title: 'Password Updated',
        description: 'Your VarTa password has been reset successfully.',
      })
      setTimeout(() => {
        navigate('/dashboard', { replace: true })
      }, 900)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password. The link or code may have expired.')
    } finally {
      setLoading(false)
    }
  }

  const needsManualOtp = !tokenHash && !hasRecoverySession

  return (
    <div className="min-h-screen varta-canvas flex items-center justify-center p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md varta-card rounded-[28px] p-8 sm:p-9"
      >
        <div className="mb-6">
          <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6E748C] hover:text-[#151722] mb-4">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Sign In
          </Link>
          <div className="flex items-center gap-2.5 mb-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center text-white font-display font-bold">
              V
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#4D4CEF]/10 text-[#4D4CEF] border border-[#4D4CEF]/20">
              Password Recovery
            </span>
          </div>
          <h1 className="font-display text-2xl font-bold text-[#151722] tracking-tight">Set a new password</h1>
          <p className="text-xs text-[#6E748C] mt-1">
            {tokenHash || hasRecoverySession
              ? 'Your reset link is ready. Choose or generate a strong new password below.'
              : 'Enter your company email and the one-time code from your reset email.'}
          </p>
        </div>

        {completed ? (
          <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
            <p className="text-sm font-bold text-emerald-900">Password reset complete</p>
            <p className="text-xs text-emerald-700">Redirecting you into your VarTa workspace...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {needsManualOtp && (
              <>
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
                  <label className="block text-xs font-semibold text-[#454A62] mb-1.5">6-Digit Recovery Code</label>
                  <div className="relative">
                    <KeyRound className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.trim())}
                      placeholder="123456"
                      className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl font-mono text-sm tracking-widest"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label className="block text-xs font-semibold text-[#454A62]">New Password</label>
                <div className="flex items-center gap-3">
                  {newPassword && (
                    <button
                      type="button"
                      onClick={handleCopy}
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
                    onClick={handleGenerate}
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
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
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
              <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Confirm New Password</label>
              <div className="relative">
                <Lock className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
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
              className="w-full py-3 px-5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_12px_26px_-8px_rgba(21,22,28,0.45)] transition-all"
            >
              {loading ? 'Updating Password...' : 'Save New Password'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        )}
      </motion.div>
    </div>
  )
}
