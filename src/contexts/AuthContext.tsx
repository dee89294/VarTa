/**
 * File: src/contexts/AuthContext.tsx
 * Purpose: Central Supabase Auth and User Profile context (`AuthProvider` + `useAuth()`).
 * Why required: Manages authenticated organizer/user sessions (`user`, `session`, `profile`),
 *   automatically restores sessions on refresh, ensures a `public.profiles` row exists on signup/login,
 *   and provides `refreshProfile()` and `signOut()`. Guests remain unauthenticated (`user === null`).
 * Connected files:
 *   - `src/App.tsx` (wraps router inside `<AuthProvider>`)
 *   - `src/lib/supabase.ts` (`supabase.auth` and `public.profiles`)
 *   - `src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `DashboardPage.tsx`, `MeetingRoomPage.tsx`
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<Profile | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const syncUserProfile = useCallback(async (authUser: User | null): Promise<Profile | null> => {
    if (!authUser) {
      setProfile(null)
      setLoading(false)
      return null
    }

    try {
      const { data: existing, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, created_at, updated_at')
        .eq('id', authUser.id)
        .maybeSingle()

      if (error) throw error
      if (existing) {
        setProfile(existing as Profile)
        return existing as Profile
      }

      // Fallback profile upsert in case user was provisioned before migration or trigger
      const email = (authUser.email || '').trim().toLowerCase()
      const fallbackName = String(
        authUser.user_metadata?.full_name || (email ? email.split('@')[0] : 'VARTA User')
      ).trim()

      if (email) {
        const { data: created } = await supabase
          .from('profiles')
          .upsert({ id: authUser.id, full_name: fallbackName, email }, { onConflict: 'id' })
          .select('id, full_name, email, created_at, updated_at')
          .maybeSingle()

        if (created) {
          setProfile(created as Profile)
          return created as Profile
        }
      }

      const synthetic: Profile = {
        id: authUser.id,
        full_name: fallbackName,
        email,
        created_at: authUser.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setProfile(synthetic)
      return synthetic
    } catch {
      const fallbackEmail = (authUser.email || '').trim().toLowerCase()
      const synthetic: Profile = {
        id: authUser.id,
        full_name: String(authUser.user_metadata?.full_name || fallbackEmail.split('@')[0] || 'VARTA User'),
        email: fallbackEmail,
        created_at: authUser.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setProfile(synthetic)
      return synthetic
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()
    setUser(currentUser)
    return await syncUserProfile(currentUser)
  }, [syncUserProfile])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return
      setSession(initialSession)
      setUser(initialSession?.user ?? null)
      syncUserProfile(initialSession?.user ?? null)
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
      syncUserProfile(nextSession?.user ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [syncUserProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setProfile(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
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
