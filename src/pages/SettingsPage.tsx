/**
 * File: src/pages/SettingsPage.tsx
 * Purpose: Profile & Settings page styled in Crisp White, Soft Alabaster, Royal Indigo (`#4D4CEF`),
 *   and Orchid Violet (`#9C65E5`) allowing users to update permitted personal details and Super Admins
 *   to configure platform governance policies.
 * Why required: Enforces separation between employee-editable profile fields and admin-locked HR fields
 *   (backed by `private.protect_employee_columns()` in Postgres) and uploads photos to Supabase Storage.
 * Connected files:
 *   - `src/App.tsx` (route `/settings`)
 *   - `src/contexts/AuthContext.tsx` (`employee`, `user`, `role`, `refreshProfile()`)
 *   - `src/lib/supabase.ts` (uploads to Storage bucket `avatars`, updates `employees`, calls `auth.updateUser`,
 *     and updates `platform_settings` when `role === 'super_admin'`)
 * Impact if modified/removed: Users cannot upload profile photos, update passwords, or configure platform defaults.
 */
import React, { useEffect, useState } from 'react'
import { Upload, Lock, Save, ShieldCheck, UserCog, Server, Send, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { getDisplayEmployeeId } from '../lib/orgUtils'
import { PageTransition } from '../components/ui/MotionPrimitives'
import { Avatar } from '../components/ui/Avatar'
import { RoleBadge } from '../components/ui/StatusBadge'
import type { PlatformSettings } from '../types/database'

export function SettingsPage() {
  const { employee, user, role, refreshProfile } = useAuth()
  const { toast } = useToast()

  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [bio, setBio] = useState(employee?.bio ?? '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(employee?.avatar_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [savingPass, setSavingPass] = useState(false)

  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [showSmtpPass, setShowSmtpPass] = useState(false)
  const [testingSmtp, setTestingSmtp] = useState(false)

  useEffect(() => {
    setPhone(employee?.phone ?? '')
    setBio(employee?.bio ?? '')
    setAvatarUrl(employee?.avatar_url ?? null)
  }, [employee])

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSettings(data as PlatformSettings)
      })
  }, [])

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploading(true)
    try {
      const ext = file.name.split('.').pop() || 'png'
      const path = `${user.id}/avatar-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
      if (employee) {
        await supabase.from('employees').update({ avatar_url: data.publicUrl }).eq('id', employee.id)
        await refreshProfile()
      }
      toast({ type: 'success', title: 'Profile Photo Updated' })
    } catch (err) {
      toast({ type: 'error', title: 'Upload failed', description: err instanceof Error ? err.message : 'Error' })
    } finally {
      setUploading(false)
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee) return
    setSavingProfile(true)
    try {
      const { error } = await supabase
        .from('employees')
        .update({ phone: phone.trim(), bio: bio.trim(), avatar_url: avatarUrl })
        .eq('id', employee.id)
      if (error) throw error
      await refreshProfile()
      toast({ type: 'success', title: 'Profile Saved' })
    } catch (err) {
      toast({ type: 'error', title: 'Update failed', description: err instanceof Error ? err.message : 'Error' })
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      toast({ type: 'warning', title: 'Password must be at least 8 characters' })
      return
    }
    setSavingPass(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword('')
      toast({ type: 'success', title: 'Password Updated' })
    } catch (err) {
      toast({ type: 'error', title: 'Password update failed', description: err instanceof Error ? err.message : 'Error' })
    } finally {
      setSavingPass(false)
    }
  }

  const handleSavePlatformSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings || !employee || role !== 'super_admin') return
    setSavingSettings(true)
    try {
      const { error } = await supabase
        .from('platform_settings')
        .update({
          company_name: settings.company_name,
          default_waiting_room: settings.default_waiting_room,
          prevent_double_booking: settings.prevent_double_booking,
          attendance_grace_minutes: settings.attendance_grace_minutes,
          allow_employee_directory: settings.allow_employee_directory,
          smtp_enabled: settings.smtp_enabled ?? false,
          smtp_host: settings.smtp_host ?? '',
          smtp_port: Number(settings.smtp_port) || 587,
          smtp_user: settings.smtp_user ?? '',
          smtp_pass: settings.smtp_pass ?? '',
          smtp_secure: settings.smtp_secure ?? false,
          smtp_from_email: settings.smtp_from_email ?? 'invites@varta.io',
          smtp_from_name: settings.smtp_from_name ?? 'VarTa Meetings',
          updated_by: employee.id,
        })
        .eq('id', 1)
      if (error) throw error
      toast({ type: 'success', title: 'Platform & SMTP Settings Saved' })
    } catch (err) {
      toast({ type: 'error', title: 'Save failed', description: err instanceof Error ? err.message : 'Error' })
    } finally {
      setSavingSettings(false)
    }
  }

  const handleTestSmtp = async () => {
    if (!settings?.smtp_host && !settings?.smtp_enabled) {
      toast({ type: 'warning', title: 'Configure SMTP host first', description: 'Enter SMTP server details and check enable.' })
      return
    }
    setTestingSmtp(true)
    try {
      const res = await invokeEdgeFunction<{ ok: boolean; message?: string }>('meeting-access', {
        action: 'test_smtp',
        target_email: employee?.email || 'kumardeepakpk947@gmail.com',
      })
      if (res?.ok) {
        toast({
          type: 'success',
          title: 'SMTP Test Email Sent',
          description: `Dispatched test email to ${employee?.email || 'kumardeepakpk947@gmail.com'}.`,
        })
      } else {
        toast({
          type: 'error',
          title: 'SMTP Test Failed',
          description: res?.message || 'Check host, port, user and app password credentials.',
        })
      }
    } catch (err) {
      toast({
        type: 'error',
        title: 'SMTP Test Request Failed',
        description: err instanceof Error ? err.message : 'Could not reach server',
      })
    } finally {
      setTestingSmtp(false)
    }
  }

  return (
    <PageTransition className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight">
          Profile & Settings
        </h1>
        <p className="text-sm text-[#6E748C] mt-1">
          Update permitted personal contact details, upload your profile photo, and manage credentials.
        </p>
      </div>

      <div className="grid md:grid-cols-12 gap-6">
        <form onSubmit={handleSaveProfile} className="md:col-span-7 varta-card rounded-[28px] p-6 space-y-4">
          <div className="flex items-center gap-4 pb-4 border-b border-[#EEF0F7]">
            <Avatar name={employee?.full_name} src={avatarUrl} size="xl" shape="circle" />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-[#151722]">{employee?.full_name}</h2>
                {role && <RoleBadge role={role} />}
              </div>
              <p className="text-xs font-mono font-semibold text-[#4D4CEF]">
                {getDisplayEmployeeId(employee) ? `${getDisplayEmployeeId(employee)} • ` : 'Leadership • '}
                {employee?.email}
              </p>
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] border border-[#DDE1EE] text-xs font-semibold text-[#151722]">
                <Upload className="h-3.5 w-3.5 text-[#4D4CEF]" />
                {uploading ? 'Uploading...' : 'Change Profile Photo'}
                <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-[#6E748C] mb-1">Department (Admin Managed)</label>
              <input
                type="text"
                disabled
                value={employee?.department?.name || 'Unassigned'}
                className="w-full px-3.5 py-2.5 rounded-2xl bg-[#F4F5FA] border border-[#E7E9F3] text-[#7D839B]"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#6E748C] mb-1">Designation (Admin Managed)</label>
              <input
                type="text"
                disabled
                value={employee?.designation || ''}
                className="w-full px-3.5 py-2.5 rounded-2xl bg-[#F4F5FA] border border-[#E7E9F3] text-[#7D839B]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Phone Number</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white"
          >
            <Save className="h-3.5 w-3.5" />
            {savingProfile ? 'Saving...' : 'Save Permitted Changes'}
          </button>
        </form>

        <div className="md:col-span-5 space-y-6">
          <form onSubmit={handlePasswordChange} className="varta-card rounded-[28px] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#4D4CEF]" />
              <h2 className="font-display text-base font-bold text-[#151722]">Security & Password</h2>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">New Password</label>
              <input
                type="password"
                minLength={8}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={savingPass}
              className="w-full py-2.5 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] border border-[#E2E5F2] text-xs font-semibold text-[#151722]"
            >
              {savingPass ? 'Updating...' : 'Update Password'}
            </button>
          </form>

          {role === 'super_admin' && settings && (
            <>
              <form onSubmit={handleSavePlatformSettings} className="varta-card rounded-[28px] p-6 space-y-3.5">
                <div className="flex items-center gap-2">
                  <UserCog className="h-4 w-4 text-[#9C65E5]" />
                  <h2 className="font-display text-base font-bold text-[#151722]">Super Admin Governance</h2>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#454A62] mb-1">Organization Name</label>
                  <input
                    type="text"
                    value={settings.company_name}
                    onChange={(e) => setSettings({ ...settings, company_name: e.target.value })}
                    className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
                  />
                </div>

                <label className="flex items-center justify-between text-xs font-medium text-[#454A62] py-1 cursor-pointer">
                  <span>Default Waiting Room Enabled</span>
                  <input
                    type="checkbox"
                    checked={settings.default_waiting_room}
                    onChange={(e) => setSettings({ ...settings, default_waiting_room: e.target.checked })}
                    className="rounded border-[#CFD4E6] text-[#9C65E5]"
                  />
                </label>

                <label className="flex items-center justify-between text-xs font-medium text-[#454A62] py-1 cursor-pointer">
                  <span>Prevent Organizer Double Booking</span>
                  <input
                    type="checkbox"
                    checked={settings.prevent_double_booking}
                    onChange={(e) => setSettings({ ...settings, prevent_double_booking: e.target.checked })}
                    className="rounded border-[#CFD4E6] text-[#9C65E5]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full py-2.5 rounded-full bg-gradient-to-r from-[#8C56DC] to-[#9E67E6] hover:opacity-95 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 shadow-sm"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {savingSettings ? 'Saving Policy...' : 'Save Organization Policy'}
                </button>
              </form>

              <form onSubmit={handleSavePlatformSettings} className="varta-card rounded-[28px] p-6 space-y-3.5">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-[#4D4CEF]" />
                  <h2 className="font-display text-base font-bold text-[#151722]">SMTP Notification Server</h2>
                </div>
                <p className="text-xs text-[#6E748C]">
                  Configure organization SMTP server so employees receive official meeting invites and schedule details on their email.
                </p>

                <label className="flex items-center justify-between text-xs font-semibold text-[#151722] py-1 cursor-pointer">
                  <span>Enable SMTP Email Dispatch</span>
                  <input
                    type="checkbox"
                    checked={settings.smtp_enabled ?? false}
                    onChange={(e) => setSettings({ ...settings, smtp_enabled: e.target.checked })}
                    className="rounded border-[#CFD4E6] text-[#4D4CEF]"
                  />
                </label>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold text-[#454A62] mb-1">SMTP Host</label>
                    <input
                      type="text"
                      placeholder="e.g. smtp.gmail.com"
                      value={settings.smtp_host ?? ''}
                      onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                      className="varta-input w-full px-3 py-2 rounded-2xl text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#454A62] mb-1">Port</label>
                    <input
                      type="number"
                      placeholder="587"
                      value={settings.smtp_port ?? 587}
                      onChange={(e) => setSettings({ ...settings, smtp_port: Number(e.target.value) })}
                      className="varta-input w-full px-3 py-2 rounded-2xl text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#454A62] mb-1">SMTP Username / Email</label>
                    <input
                      type="text"
                      placeholder="e.g. notifications@company.com"
                      value={settings.smtp_user ?? ''}
                      onChange={(e) => setSettings({ ...settings, smtp_user: e.target.value })}
                      className="varta-input w-full px-3 py-2 rounded-2xl text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#454A62] mb-1">SMTP Password / App Secret</label>
                    <div className="relative">
                      <input
                        type={showSmtpPass ? 'text' : 'password'}
                        placeholder="••••••••••••"
                        value={settings.smtp_pass ?? ''}
                        onChange={(e) => setSettings({ ...settings, smtp_pass: e.target.value })}
                        className="varta-input w-full pl-3 pr-9 py-2 rounded-2xl text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPass(!showSmtpPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8D92A8] hover:text-[#151722]"
                      >
                        {showSmtpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#454A62] mb-1">From Email</label>
                    <input
                      type="email"
                      placeholder="invites@varta.io"
                      value={settings.smtp_from_email ?? ''}
                      onChange={(e) => setSettings({ ...settings, smtp_from_email: e.target.value })}
                      className="varta-input w-full px-3 py-2 rounded-2xl text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#454A62] mb-1">Sender Name</label>
                    <input
                      type="text"
                      placeholder="VarTa Meetings"
                      value={settings.smtp_from_name ?? ''}
                      onChange={(e) => setSettings({ ...settings, smtp_from_name: e.target.value })}
                      className="varta-input w-full px-3 py-2 rounded-2xl text-xs"
                    />
                  </div>
                </div>

                <label className="flex items-center justify-between text-xs font-medium text-[#454A62] py-0.5 cursor-pointer">
                  <span>SSL / TLS Encryption (Port 465)</span>
                  <input
                    type="checkbox"
                    checked={settings.smtp_secure ?? false}
                    onChange={(e) => setSettings({ ...settings, smtp_secure: e.target.checked })}
                    className="rounded border-[#CFD4E6] text-[#4D4CEF]"
                  />
                </label>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleTestSmtp}
                    disabled={testingSmtp}
                    className="flex-1 py-2 rounded-full bg-[#F4F5FA] hover:bg-[#E7EAF5] border border-[#DCE0F0] text-xs font-semibold text-[#151722] inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Send className="h-3.5 w-3.5 text-[#4D4CEF]" />
                    {testingSmtp ? 'Sending Test...' : 'Test Connection'}
                  </button>
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="flex-1 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save SMTP
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </PageTransition>
  )
}
