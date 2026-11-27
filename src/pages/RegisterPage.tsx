/**
 * File: src/pages/RegisterPage.tsx
 * Purpose: Two-step self-service employee onboarding screen verified server-side against HR records
 *   in the clean Lavender-Alabaster & Royal Indigo studio aesthetic.
 * Why required: Prevents unauthorized users from signing up with arbitrary emails or random Employee IDs.
 *   Only records pre-created by the Super Admin with `status = 'invited'` can complete registration.
 * Connected files:
 *   - `src/App.tsx` (renders `/register` inside `PublicOnlyRoute`)
 *   - `src/lib/supabase.ts` (`invokeEdgeFunction('employee-registration', ..., false)` & `supabase.auth.signInWithPassword`)
 *   - `supabase/functions/employee-registration/index.ts` (performs server-side lookup & Auth creation)
 *   - `src/contexts/AuthContext.tsx` (`refreshProfile()` loads the newly activated employee profile)
 *   - `src/pages/EmployeesPage.tsx` (where Super Admins create the prerequisite employee invitations)
 * Data flow:
 *   1. Step 1 (`handleVerify`): Sends `employee_code` + `email` to `employee-registration` (`action: 'verify'`).
 *   2. Step 2 (`handleRegister`): Sends password + phone to `employee-registration` (`action: 'register'`),
 *      which creates `auth.users`, links `employees.auth_user_id`, assigns `user_roles`, and signs in.
 * Impact if modified/removed: Invited employees cannot activate accounts; altering verification weakens onboarding security.
 */
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BadgeCheck,
  Mail,
  IdCard,
  Lock,
  Phone,
  ArrowLeft,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Check,
} from 'lucide-react'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { generateStrongPassword } from '../lib/utils'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

interface VerifiedEmployeeInfo {
  id: string
  employee_code: string
  full_name: string
  email: string
  designation: string
  intended_role: string
  department_name: string
  team_name: string | null
}

export function RegisterPage() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const { toast } = useToast()

  const [step, setStep] = useState<'verify' | 'credentials'>('verify')
  const [employeeCode, setEmployeeCode] = useState('')
  const [email, setEmail] = useState('')
  const [verifiedEmployee, setVerifiedEmployee] = useState<VerifiedEmployeeInfo | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [copiedPassword, setCopiedPassword] = useState(false)
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGeneratePassword = () => {
    const generated = generateStrongPassword(12)
    setPassword(generated)
    setConfirmPassword(generated)
    setShowPassword(true)
    setCopiedPassword(false)
    setError(null)
  }

  const handleCopyPassword = async () => {
    if (!password) return
    try {
      await navigator.clipboard.writeText(password)
      setCopiedPassword(true)
      setTimeout(() => setCopiedPassword(false), 2000)
    } catch {
      // clipboard unavailable
    }
  }

  /**
   * Step 1: Calls the `employee-registration` Edge Function (`action: 'verify'`) without an auth token
   * to verify that the entered Employee ID + company email matches an active HR invitation.
   */
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await invokeEdgeFunction<{ verified: boolean; employee: VerifiedEmployeeInfo }>(
        'employee-registration',
        {
          action: 'verify',
          employee_code: employeeCode,
          email,
        },
        false
      )
      setVerifiedEmployee(res.employee)
      setStep('credentials')
      toast({
        type: 'success',
        title: 'Employee Invitation Verified',
        description: `Record found for ${res.employee.full_name} (${res.employee.employee_code}).`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Step 2: Calls `employee-registration` (`action: 'register'`) to provision the Auth account server-side,
   * then immediately logs the new employee in and hydrates `AuthContext`.
   */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

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
      await invokeEdgeFunction(
        'employee-registration',
        {
          action: 'register',
          employee_code: employeeCode,
          email,
          password,
          phone,
        },
        false
      )

      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (loginErr) throw loginErr

      await refreshProfile()
      toast({
        type: 'success',
        title: 'Account Activated',
        description: 'Welcome to VarTa! Redirecting to your personal dashboard.',
      })
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen varta-canvas flex items-center justify-center p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-xl varta-card rounded-[28px] p-8 sm:p-10 relative overflow-hidden"
      >
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#666C85] hover:text-[#151722] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Login
          </Link>
          <div className="inline-flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center text-white font-display font-bold text-sm shadow-sm">
              V
            </div>
            <span className="font-display font-bold text-sm text-[#151722]">VarTa Onboarding</span>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border ${
              step === 'verify'
                ? 'bg-[#4D4CEF]/10 text-[#4D4CEF] border-[#4D4CEF]/25'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            <span>1. Verify Employee ID</span>
          </div>
          <div className="h-px flex-1 bg-[#E5E8F2]" />
          <div
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border ${
              step === 'credentials'
                ? 'bg-[#4D4CEF]/10 text-[#4D4CEF] border-[#4D4CEF]/25'
                : 'bg-[#F4F5FA] text-[#8D92A8] border-[#E5E8F2]'
            }`}
          >
            <span>2. Create Credentials</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === 'verify' ? (
            <motion.form
              key="verify"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              onSubmit={handleVerify}
              className="space-y-4"
            >
              <div>
                <h1 className="font-display text-2xl font-bold text-[#151722] tracking-tight">Employee Registration</h1>
                <p className="text-sm text-[#6E748C] mt-1">
                  Registration is strictly verified server-side against records pre-approved by your Super Admin.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#454A62] mb-1.5">
                  Employee ID <span className="text-[11px] font-normal text-[#7D839B]">(Format: AIPL-numbers)</span>
                </label>
                <div className="relative">
                  <IdCard className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    pattern="^AIPL-[0-9]+$"
                    title="Employee ID must follow format AIPL-(numbers), e.g. AIPL-009"
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
                    placeholder="e.g. AIPL-009"
                    className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Company Email Address</label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. employee@varta.io"
                    className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                  />
                </div>
              </div>

              {error && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-start gap-2.5">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_12px_26px_-8px_rgba(21,22,28,0.45)] transition-all"
              >
                {loading ? 'Verifying against HR database...' : 'Verify Employee Record'}
                <ArrowRight className="h-4 w-4" />
              </button>

              <div className="p-4 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] text-xs text-[#666C85]">
                <p className="font-semibold text-[#151722]">Pre-invited Employee Verification</p>
                <p className="mt-1">
                  Enter the <span className="font-mono font-bold text-[#4D4CEF]">AIPL-XXX</span> Employee ID and official company email issued by your Super Admin.
                </p>
              </div>
            </motion.form>
          ) : (
            <motion.form
              key="credentials"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              onSubmit={handleRegister}
              className="space-y-4"
            >
              {verifiedEmployee && (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                  <BadgeCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-bold text-emerald-900">
                      Identity Matched: {verifiedEmployee.full_name} ({verifiedEmployee.employee_code})
                    </p>
                    <p className="text-emerald-700">
                      {verifiedEmployee.designation} • {verifiedEmployee.department_name}
                      {verifiedEmployee.team_name ? ` / ${verifiedEmployee.team_name}` : ''}
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Phone Number (Optional)</label>
                <div className="relative">
                  <Phone className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98201 00000"
                    className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-semibold text-[#454A62]">Create or Generate Password</label>
                  <div className="flex items-center gap-3">
                    {password && (
                      <button
                        type="button"
                        onClick={handleCopyPassword}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#454A62] hover:text-[#151722]"
                      >
                        {copiedPassword ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copy
                          </>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleGeneratePassword}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4D4CEF] hover:underline"
                    >
                      <KeyRound className="h-3 w-3" /> Generate Strong Password
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
                    className="varta-input w-full pl-10 pr-10 py-2.5 rounded-2xl text-sm font-mono"
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
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="varta-input w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm font-mono"
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('verify')}
                  className="px-4 py-2.5 rounded-full bg-[#F1F3F9] hover:bg-[#E5E8F2] text-xs font-semibold text-[#454A62]"
                >
                  Change ID
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 px-5 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {loading ? 'Activating Account...' : 'Activate & Enter Dashboard'}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
