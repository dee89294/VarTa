/**
 * File: src/contexts/AuthContext.tsx
 * Purpose: Central authentication and RBAC identity provider (`AuthProvider` + `useAuth()` hook).
 * Why required: Supabase Auth stores login identity (`auth.users`), while VarTa stores employee identity
 *   (`public.employees`) and role permissions (`public.user_roles`). This context merges all three into
 *   one reactive source of truth for the frontend.
 * Connected files:
 *   - `src/App.tsx` (wraps routes in `<AuthProvider>` and reads `user`, `employee`, `loading` in route guards)
 *   - `src/lib/supabase.ts` (uses `supabase.auth` and queries `public.employees` + `public.user_roles`)
 *   - `src/types/database.ts` (`Employee`, `UserRole`)
 *   - `src/pages/LoginPage.tsx` & `RegisterPage.tsx` (call `refreshProfile()` immediately after sign-in)
 *   - `src/components/layout/AppShell.tsx` & every page (read `employee`, `role`, `signOut`)
 * Data flow:
 *   1. On startup or `onAuthStateChange`, resolves the Supabase Auth user (`auth.uid()`).
 *   2. Fetches matching `public.employees` (with `departments` and `teams`) and `public.user_roles`.
 *   3. Rejects and signs out any user whose employee status is not `'active'` (e.g., deactivated accounts).
 * Impact if modified/removed: Protected routes, role-based sidebar filtering, and employee-scoped queries break.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Employee, UserRole } from '../types/database'

interface AuthContextValue {
  session: Session | null
  user: User | null
  employee: Employee | null
  role: UserRole | null
  loading: boolean
  authError: string | null
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  /**
   * Resolves the authenticated Supabase Auth user against `public.employees` and `public.user_roles`.
   * Connected tables: `employees`, `departments`, `teams`, `user_roles`.
   * Security guarantee: If a user is deactivated (`status !== 'active'`) or unlinked from an employee
   * record, their session is immediately signed out and workspace access is denied.
   */
  const loadEmployeeContext = useCallback(async (authUser: User | null) => {
    if (!authUser) {
      setEmployee(null)
      setRole(null)
      setAuthError(null)
      setLoading(false)
      return
    }

    try {
      const [{ data: empData, error: empErr }, { data: roleData, error: roleErr }] = await Promise.all([
        supabase
          .from('employees')
          .select('*, department:departments!employees_department_id_fkey(id, name, code), team:teams!employees_team_id_fkey(id, name, department_id)')
          .eq('auth_user_id', authUser.id)
          .maybeSingle(),
        supabase.from('user_roles').select('role').eq('user_id', authUser.id).maybeSingle(),
      ])

      if (empErr) throw empErr
      if (roleErr) throw roleErr

      if (!empData) {
        setAuthError('No authorized employee profile is linked to this login.')
        setEmployee(null)
        setRole(null)
      } else if (empData.status !== 'active') {
        setAuthError('Your employee account has been deactivated. Contact your Super Admin.')
        setEmployee(null)
        setRole(null)
        await supabase.auth.signOut()
      } else {
        setAuthError(null)
        setEmployee(empData as Employee)
        setRole((roleData?.role as UserRole) || empData.intended_role || 'employee')
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed loading employee session')
      setEmployee(null)
      setRole(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()
    setUser(currentUser)
    await loadEmployeeContext(currentUser)
  }, [loadEmployeeContext])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return
      setSession(initialSession)
      setUser(initialSession?.user ?? null)
      loadEmployeeContext(initialSession?.user ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      if (nextSession?.user) {
        setLoading(true)
      }
      loadEmployeeContext(nextSession?.user ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [loadEmployeeContext])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setEmployee(null)
    setRole(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        employee,
        role,
        loading,
        authError,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
