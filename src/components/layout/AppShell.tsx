/**
 * File: src/components/layout/AppShell.tsx
 * Purpose: Airy Lavender-Alabaster SaaS navigation shell with floating white icon-tile sidebar (plus
 *   collapsible compact rail mode), responsive mobile drawer, `"Welcome Back"` top header, circular
 *   search modal/bar, colleague avatar cluster, real-time notifications bell, and Obsidian Charcoal action pill.
 * Why required: Provides unified light-studio navigation and real-time notification/live-meeting counters across all routes.
 * Connected files:
 *   - `src/App.tsx` (renders `<AppShell />` as the parent layout route with `<Outlet />`)
 *   - `src/contexts/AuthContext.tsx` (reads `employee`, `role`, and calls `signOut()`)
 *   - `src/lib/supabase.ts` (queries & subscribes via Realtime to `notifications`, `meetings`, and active `employees`)
 *   - `src/components/ui/Avatar.tsx` & `src/components/ui/StatusBadge.tsx`
 * Data flow:
 *   - Filters `navItems` by `role` (`super_admin`, `organizer`, `employee`) so unauthorized nav links remain hidden.
 *   - Subscribes to `postgres_changes` on `public.notifications` (filtered by `recipient_employee_id`) and `public.meetings`.
 *   - Clicking a notification marks it read in Supabase and navigates directly to `/meetings/:id`.
 * Impact if modified/removed: Breaks sidebar navigation, mobile drawer, logout flow, and live notification alerts.
 */
import React, { useEffect, useState, useMemo } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LayoutDashboard,
  Video,
  CalendarPlus,
  Radio,
  CalendarDays,
  Users,
  UsersRound,
  ClipboardCheck,
  BarChart3,
  Settings,
  LogOut,
  Bell,
  Search,
  Menu,
  X,
  CheckCheck,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { cn, formatDateTime } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'
import { RoleBadge } from '../ui/StatusBadge'
import type { Employee, NotificationItem, UserRole } from '../../types/database'

interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
  badge?: string
}

export function AppShell() {
  const { employee, role, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [colleagues, setColleagues] = useState<Pick<Employee, 'id' | 'full_name' | 'avatar_url'>[]>([])
  const [totalColleagues, setTotalColleagues] = useState(0)
  const [liveCount, setLiveCount] = useState(0)
  const [quickSearch, setQuickSearch] = useState('')

  const navItems: NavItem[] = useMemo(
    () => [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, roles: ['super_admin', 'organizer', 'employee'] },
      { label: 'My Meetings', to: '/my-meetings', icon: Video, roles: ['super_admin', 'organizer', 'employee'] },
      { label: 'Schedule', to: '/schedule-meeting', icon: CalendarPlus, roles: ['super_admin', 'organizer'] },
      {
        label: 'Live Rooms',
        to: '/live-meetings',
        icon: Radio,
        roles: ['super_admin', 'organizer', 'employee'],
        badge: liveCount > 0 ? String(liveCount) : undefined,
      },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays, roles: ['super_admin', 'organizer', 'employee'] },
      { label: 'Employees', to: '/employees', icon: Users, roles: ['super_admin'] },
      { label: 'Teams', to: '/teams', icon: UsersRound, roles: ['super_admin', 'organizer', 'employee'] },
      { label: 'Attendance', to: '/attendance', icon: ClipboardCheck, roles: ['super_admin', 'organizer', 'employee'] },
      { label: 'Reports', to: '/reports', icon: BarChart3, roles: ['super_admin', 'organizer'] },
      { label: 'Settings', to: '/settings', icon: Settings, roles: ['super_admin', 'organizer', 'employee'] },
    ],
    [liveCount]
  )

  const visibleNav = navItems.filter((item) => (role ? item.roles.includes(role) : false))

  useEffect(() => {
    if (!employee) return

    const loadInitial = async () => {
      const [{ data: notifs }, { count: liveMeetingsCount }, { data: peers, count: peerCount }] = await Promise.all([
        supabase
          .from('notifications')
          .select('*')
          .eq('recipient_employee_id', employee.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('meetings')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'live'),
        supabase
          .from('employees')
          .select('id, full_name, avatar_url', { count: 'exact' })
          .eq('status', 'active')
          .eq('is_founding_member', false)
          .order('employee_code')
          .limit(4),
      ])
      setNotifications((notifs ?? []) as NotificationItem[])
      setLiveCount(liveMeetingsCount ?? 0)
      setColleagues((peers ?? []) as Pick<Employee, 'id' | 'full_name' | 'avatar_url'>[])
      setTotalColleagues(peerCount ?? 0)
    }

    loadInitial()

    const channel = supabase
      .channel(`shell-sync-${employee.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_employee_id=eq.${employee.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setNotifications((prev) => [payload.new as NotificationItem, ...prev.slice(0, 19)])
          } else if (payload.eventType === 'UPDATE') {
            setNotifications((prev) =>
              prev.map((n) => (n.id === (payload.new as NotificationItem).id ? (payload.new as NotificationItem) : n))
            )
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meetings' },
        async () => {
          const { count } = await supabase
            .from('meetings')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'live')
          setLiveCount(count ?? 0)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [employee])

  const unreadCount = notifications.filter((n) => !n.is_read).length

  const markAllRead = async () => {
    if (!employee || unreadCount === 0) return
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_employee_id', employee.id)
      .eq('is_read', false)
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  const handleNotificationClick = async (n: NotificationItem) => {
    if (!n.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
      setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item)))
    }
    setNotifOpen(false)
    if (n.meeting_id) {
      navigate(`/meetings/${n.meeting_id}`)
    }
  }

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickSearch.trim()) return
    navigate(`/teams?q=${encodeURIComponent(quickSearch.trim())}`)
    setSearchOpen(false)
  }

  const firstName = employee?.full_name?.split(' ')[0] || 'Member'
  const extraColleagues = Math.max(0, totalColleagues - colleagues.length)

  const renderSidebar = (isMobile = false) => {
    const compact = !isMobile && railCollapsed
    return (
      <div className="flex flex-col h-full bg-[#F7F8FC]/95 backdrop-blur-xl border-r border-[#E6E8F2] select-none">
        {/* Brand Header (Matches Vibrant Cobalt-Indigo App Square) */}
        <div className={cn('flex items-center py-5 border-b border-[#ECEDF5]', compact ? 'justify-center px-3' : 'justify-between px-5')}>
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[#4749EB] to-[#6163F6] flex items-center justify-center shadow-[0_10px_22px_-6px_rgba(77,76,239,0.5)] text-white font-display font-extrabold text-lg">
              V
            </div>
            {!compact && (
              <div>
                <span className="font-display font-bold text-lg tracking-tight text-[#151722]">VarTa</span>
                <p className="text-[11px] text-[#7D839B] leading-none mt-0.5">Workforce Studio</p>
              </div>
            )}
          </div>
          {isMobile ? (
            <button
              onClick={() => setMobileOpen(false)}
              className="p-2 rounded-full bg-white border border-[#E5E8F2] text-[#666C84] hover:text-[#151722]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            !compact && (
              <button
                onClick={() => setRailCollapsed(true)}
                title="Collapse sidebar to icon rail"
                className="p-1.5 rounded-xl text-[#8D92A8] hover:text-[#151722] hover:bg-white transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )
          )}
        </div>

        {compact && (
          <div className="flex justify-center pt-3">
            <button
              onClick={() => setRailCollapsed(false)}
              title="Expand sidebar"
              className="p-2 rounded-xl bg-white border border-[#E5E8F2] text-[#666C84] hover:text-[#4D4CEF] shadow-sm transition-colors"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Navigation Tiles */}
        <nav className={cn('flex-1 overflow-y-auto py-4 space-y-1.5', compact ? 'px-3' : 'px-3.5')}>
          {visibleNav.map((item) => {
            const Icon = item.icon
            const active =
              location.pathname === item.to ||
              (item.to === '/live-meetings' && location.pathname.startsWith('/meetings/'))
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={compact ? item.label : undefined}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'group relative flex items-center rounded-2xl text-[13px] font-medium transition-all duration-200',
                  compact ? 'justify-center h-12 w-12 mx-auto' : 'justify-between px-3 py-2.5',
                  active
                    ? 'bg-white text-[#151722] shadow-[0_8px_22px_-8px_rgba(25,28,64,0.14)] border border-[#E5E8F3]'
                    : 'text-[#666C85] hover:text-[#151722] hover:bg-white/80 border border-transparent'
                )}
              >
                <div className={cn('flex items-center', compact ? 'justify-center' : 'gap-3')}>
                  <div
                    className={cn(
                      'h-8 w-8 rounded-xl flex items-center justify-center transition-all duration-200',
                      active
                        ? 'bg-[#4D4CEF] text-white shadow-[0_6px_14px_-4px_rgba(77,76,239,0.5)]'
                        : 'bg-white text-[#5B6078] shadow-[0_2px_8px_rgba(21,23,34,0.05)] group-hover:text-[#4D4CEF]'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  {!compact && <span className={active ? 'font-semibold' : ''}>{item.label}</span>}
                </div>

                {!compact && (
                  <div className="flex items-center gap-2">
                    {item.badge && (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-50 text-rose-600 border border-rose-200 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                        {item.badge}
                      </span>
                    )}
                    {active && (
                      <motion.span
                        layoutId="sidebar-active-dot"
                        className="h-2 w-2 rounded-full bg-[#4D4CEF]"
                      />
                    )}
                  </div>
                )}

                {compact && item.badge && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom Profile & Logout */}
        <div className="p-3.5 border-t border-[#ECEDF5] space-y-2.5">
          {employee && !compact && (
            <div className="p-2.5 rounded-2xl bg-white border border-[#E7E9F3] shadow-sm flex items-center gap-2.5">
              <Avatar name={employee.full_name} src={employee.avatar_url} size="sm" shape="circle" statusDot="online" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#151722] truncate">{employee.full_name}</p>
                <p className="text-[11px] font-mono text-[#4D4CEF] truncate">{employee.employee_code}</p>
              </div>
              {role && <RoleBadge role={role} />}
            </div>
          )}

          {employee && compact && (
            <div className="flex justify-center">
              <button onClick={() => navigate('/settings')} title={employee.full_name}>
                <Avatar name={employee.full_name} src={employee.avatar_url} size="sm" shape="circle" statusDot="online" />
              </button>
            </div>
          )}

          <button
            onClick={handleLogout}
            title="Logout"
            className={cn(
              'w-full flex items-center rounded-2xl text-xs font-semibold text-[#666C85] hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all',
              compact ? 'justify-center py-2.5' : 'gap-2.5 px-3.5 py-2.5'
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!compact && <span>Logout</span>}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen varta-canvas text-[#151722] flex">
      {/* Desktop Sidebar / Icon Rail */}
      <aside className={cn('hidden lg:block shrink-0 sticky top-0 h-screen transition-all duration-200', railCollapsed ? 'w-20' : 'w-64')}>
        {renderSidebar(false)}
      </aside>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 bg-[#151722]/30 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="relative z-10 w-68 h-full"
            >
              {renderSidebar(true)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Application Header matching Reference Style */}
        <header className="sticky top-0 z-30 min-h-[74px] px-4 sm:px-6 lg:px-8 py-3 bg-[#F3F4F9]/85 backdrop-blur-xl border-b border-[#E6E8F2]/80 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden h-10 w-10 rounded-full bg-white border border-[#E5E8F2] shadow-sm flex items-center justify-center text-[#454A62]"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="font-display text-xl sm:text-2xl font-semibold text-[#151722] tracking-tight truncate">
                  Welcome Back, {firstName}
                </h1>
                {employee?.department?.name && (
                  <span className="hidden md:inline-flex items-center px-2.5 py-0.5 rounded-full bg-white border border-[#E5E8F2] text-[11px] font-medium text-[#6C728A] shadow-xs">
                    {employee.department.name}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Search Pill / Toggle (Reference circular search button) */}
            {searchOpen ? (
              <form onSubmit={handleSearchSubmit} className="relative flex items-center">
                <Search className="h-4 w-4 text-[#8B91A7] absolute left-3.5" />
                <input
                  type="text"
                  autoFocus
                  value={quickSearch}
                  onChange={(e) => setQuickSearch(e.target.value)}
                  placeholder="Search people or teams..."
                  className="pl-9 pr-8 py-2 rounded-full bg-white border border-[#DCE0EE] text-xs text-[#151722] w-48 sm:w-64 shadow-sm focus:outline-none focus:border-[#4D4CEF]"
                />
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  className="absolute right-2.5 text-[#8B91A7] hover:text-[#151722]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                title="Search team directory"
                className="h-10 w-10 rounded-full bg-white hover:bg-[#FAFBFD] border border-[#E5E8F2] shadow-sm flex items-center justify-center text-[#151722] transition-all hover:scale-[1.04]"
              >
                <Search className="h-4 w-4" />
              </button>
            )}

            {/* Colleague Overlapping Avatar Stack Pill (Matches header +32 cluster) */}
            {colleagues.length > 0 && (
              <button
                onClick={() => navigate('/teams')}
                title="View Company Directory"
                className="hidden md:inline-flex items-center bg-white border border-[#E5E8F2] rounded-full pl-1.5 pr-2.5 py-1 shadow-sm hover:border-[#4D4CEF]/40 transition-all"
              >
                <div className="flex -space-x-2">
                  {colleagues.slice(0, 3).map((c) => (
                    <Avatar
                      key={c.id}
                      name={c.full_name}
                      src={c.avatar_url}
                      size="xs"
                      shape="circle"
                      className="ring-2 ring-white"
                    />
                  ))}
                </div>
                {extraColleagues > 0 && (
                  <span className="ml-2 text-[11px] font-semibold text-[#5C627A]">+{extraColleagues}</span>
                )}
              </button>
            )}

            {/* Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => setNotifOpen((o) => !o)}
                className="relative h-10 w-10 rounded-full bg-white hover:bg-[#FAFBFD] border border-[#E5E8F2] shadow-sm flex items-center justify-center text-[#151722] transition-all hover:scale-[1.04]"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-[#4D4CEF] text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-[#F3F4F9]">
                    {unreadCount}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-3xl shadow-[0_24px_60px_-14px_rgba(24,27,60,0.2)] border border-[#E5E8F2] overflow-hidden z-50"
                  >
                    <div className="px-4 py-3.5 border-b border-[#EEF0F7] bg-[#F9FAFD] flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-[#151722]">Notifications</p>
                        <p className="text-[11px] text-[#7D839B]">{unreadCount} unread updates</p>
                      </div>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#4D4CEF] hover:underline"
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-[#F0F2F8]">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-xs text-[#8D92A8]">
                          You are all caught up. No notifications yet.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => handleNotificationClick(n)}
                            className={cn(
                              'w-full text-left px-4 py-3 hover:bg-[#F7F8FC] transition-colors flex items-start gap-3',
                              !n.is_read && 'bg-[#4D4CEF]/[0.04]'
                            )}
                          >
                            <span
                              className={cn(
                                'mt-1.5 h-2 w-2 rounded-full shrink-0',
                                n.is_read ? 'bg-[#CBD0E0]' : 'bg-[#4D4CEF]'
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[#151722]">{n.title}</p>
                              <p className="text-xs text-[#666C85] mt-0.5 line-clamp-2">{n.message}</p>
                              <p className="text-[10px] text-[#9499AE] mt-1">{formatDateTime(n.created_at)}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Obsidian Pill Action Button (Matches "+ Add Member" pill in reference header) */}
            {(role === 'super_admin' || role === 'organizer') && (
              <button
                onClick={() => navigate(role === 'super_admin' && location.pathname === '/employees' ? '/employees?add=1' : '/schedule-meeting')}
                className="inline-flex items-center gap-2 pl-2 pr-4 py-1.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-white text-xs font-semibold shadow-[0_10px_22px_-8px_rgba(21,22,28,0.45)] transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="h-6 w-6 rounded-full bg-white text-[#15161C] flex items-center justify-center">
                  <Plus className="h-3.5 w-3.5" />
                </span>
                <span className="hidden sm:inline">
                  {role === 'super_admin' && location.pathname === '/employees' ? 'Add Member' : 'Schedule Meeting'}
                </span>
              </button>
            )}
          </div>
        </header>

        {/* Main View */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
