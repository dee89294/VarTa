/**
 * File: src/pages/HomePage.tsx
 * Purpose: Minimal, Google-Meet-style public homepage for VARTA displaying:
 *   - VARTA logo
 *   - Login & Sign Up actions (or Dashboard link when authenticated)
 *   - Create Meeting CTA (redirects unauthenticated visitors to `/login?redirect=/create-meeting`)
 *   - Join Meeting input accepting a meeting invitation URL or meeting ID
 * Connected files:
 *   - `src/App.tsx` (route `/`)
 *   - `src/contexts/AuthContext.tsx` (`user`, `profile`)
 *   - `src/lib/utils.ts` (`parseMeetingTarget`)
 */
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Link2, LogIn, Plus, ShieldCheck, UserPlus, Users, Video } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { parseMeetingTarget } from '../lib/utils'

export function HomePage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [joinInput, setJoinInput] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  const handleCreateMeeting = () => {
    if (user) {
      navigate('/create-meeting')
    } else {
      navigate('/login?redirect=%2Fcreate-meeting')
    }
  }

  const handleJoinMeeting = (e: React.FormEvent) => {
    e.preventDefault()
    setJoinError(null)
    const target = parseMeetingTarget(joinInput)
    if (!target) {
      setJoinError('Paste a valid VARTA meeting invitation link or enter a Meeting ID.')
      return
    }
    navigate(target)
  }

  return (
    <div className="min-h-screen varta-canvas flex flex-col">
      {/* Minimal Top Bar */}
      <header className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-5 flex items-center justify-between gap-4">
        <Link to="/" className="inline-flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center shadow-[0_10px_22px_-6px_rgba(77,76,239,0.5)] text-white font-display font-extrabold text-lg">
            V
          </div>
          <div>
            <span className="font-display text-xl font-bold text-[#151722] tracking-tight">VarTa</span>
            <p className="text-[11px] text-[#7D839B] leading-none mt-0.5">Video Meetings</p>
          </div>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-sm transition-all"
            >
              <span>{profile?.full_name ? `${profile.full_name.split(' ')[0]}'s Dashboard` : 'Open Dashboard'}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DFE3F2] text-xs font-semibold text-[#151722] transition-colors"
              >
                <LogIn className="h-3.5 w-3.5 text-[#4D4CEF]" />
                Login
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold text-white shadow-sm transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Sign Up
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Main Centered Hero */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-14 flex items-center">
        <div className="w-full grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-6">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-[#E4E7F2] text-xs font-semibold text-[#4D4CEF] shadow-2xs">
              <Video className="h-3.5 w-3.5" />
              Crystal-clear HD meetings powered by LiveKit Cloud
            </span>

            <h1 className="font-display text-4xl sm:text-5xl font-extrabold text-[#151722] leading-[1.12] tracking-tight">
              Simple video meetings.
              <span className="block bg-gradient-to-r from-[#4D4CEF] via-[#6F5AE8] to-[#9C65E5] bg-clip-text text-transparent">
                Built for instant invites & guests.
              </span>
            </h1>

            <p className="text-base text-[#5E647B] leading-relaxed max-w-xl">
              Create private video meetings in seconds, email secure invite links automatically, and let anyone join
              as a guest with just their name — or sign in with their VARTA account.
            </p>

            {/* Primary Actions: Create Meeting + Join Meeting */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleCreateMeeting}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-sm font-semibold text-white shadow-[0_14px_28px_-10px_rgba(21,22,28,0.45)] transition-all hover:scale-[1.01] cursor-pointer"
              >
                <Plus className="h-4 w-4 text-[#9C65E5]" />
                Create Meeting
              </button>

              <form onSubmit={handleJoinMeeting} className="flex-1 flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Link2 className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={joinInput}
                    onChange={(e) => {
                      setJoinInput(e.target.value)
                      setJoinError(null)
                    }}
                    placeholder="Paste meeting link or ID..."
                    className="varta-input w-full pl-10 pr-4 py-3 rounded-full text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#DCE0F0] text-sm font-semibold text-[#151722] transition-colors cursor-pointer shrink-0"
                >
                  Join Meeting
                  <ArrowRight className="h-4 w-4 text-[#4D4CEF]" />
                </button>
              </form>
            </div>

            {joinError && (
              <p className="text-xs font-medium text-rose-600">{joinError}</p>
            )}
          </div>

          {/* Right Highlight Card */}
          <div className="lg:col-span-5 varta-card rounded-[28px] p-7 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#151722]">How VARTA Works</h2>
            {[
              {
                icon: Video,
                title: 'Registered Organizers Host',
                desc: 'Sign up or log in to create instant or scheduled meetings with unique links.',
                tint: 'bg-[#4D4CEF]/10 text-[#4D4CEF]',
              },
              {
                icon: Users,
                title: 'Guest Joining Without Accounts',
                desc: 'Invited participants can enter their full name and join audio/video calls right away.',
                tint: 'bg-[#9C65E5]/12 text-[#854DD1]',
              },
              {
                icon: ShieldCheck,
                title: 'Token-Protected Private Rooms',
                desc: 'Server-validated invitation tokens and LiveKit permissions protect every private call.',
                tint: 'bg-emerald-50 text-emerald-600',
              },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title} className="p-4 rounded-2xl bg-[#F6F7FB] border border-[#E7E9F4] flex items-start gap-3">
                  <div className={`p-2 rounded-xl shrink-0 ${item.tint}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#151722]">{item.title}</p>
                    <p className="text-xs text-[#6E748C] mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
