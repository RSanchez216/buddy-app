import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { countOpenTasks, TASKS_CHANGED_EVENT } from '../pages/command-center/commandCenterData'
import { useAuth } from '../contexts/AuthContext'
import { BuddyLogoSmall } from '../components/BuddyLogo'
import NotificationBell from './NotificationBell'
import UserMenu from './UserMenu'

// ── Icons ──────────────────────────────────────────────────────────────────
const Icons = {
  dashboard: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  vendors:   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  invoices:  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  txns:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>,
  report:    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  dept:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  category:  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>,
  payment:   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
  users:     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  debt:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  entity:    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h6m-6 4h6m-2 8v-3a1 1 0 011-1h2a1 1 0 011 1v3m-4 0H9" /></svg>,
  lender:    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3" /></svg>,
  bank:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  truck:     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8 0h6m-6 0V8h4l3 4v4m0 0h-3m-3-7h6" /></svg>,
  trailer:   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6h17v11H3V6zm0 11l-1 2m18-2l1 2M8 19a2 2 0 11-4 0 2 2 0 014 0zM20 19a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  driver:    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
  driverSale: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>,
  flag:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 21v-7m0 0V5a2 2 0 012-2h11l-2 5 2 5H5a2 2 0 00-2 2z" /></svg>,
  calendar:  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  chevron:   <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>,
  sun:       <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>,
  moon:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>,
  menu:      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" /></svg>,
  cost:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" /></svg>,
  map:       <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>,
  boardroom: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4h18v11H3V4zm6 15l3-4 3 4M8 12l2.5-3 2 2L16 7" /></svg>,
  lifeline:  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12h4l2.5-6 4 12L16 12h5" /></svg>,
  merge:     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  gear:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  command:   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v2m0 14v2m9-9h-2M5 12H3m13.95 4.95l-1.414-1.414M8.464 8.464L7.05 7.05m9.9 0l-1.414 1.414M8.464 15.536L7.05 16.95M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
}

// ── Nav item ───────────────────────────────────────────────────────────────
// Always reserves a 2px left border so the active orange marker doesn't
// shift the chip's width when it appears.
// visible prop controls whether the item should be shown (default true)
function NavItem({ to, label, icon, end = false, onClick, visible = true, count = 0 }) {
  if (!visible) return null
  return (
    <NavLink
      to={to} end={end} onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 pl-2.5 pr-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 border-l-2 ${
          isActive
            ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-orange-500 shadow-[inset_0_0_0_1px_rgba(6,182,212,0.15)]'
            : 'border-transparent text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-slate-200'
        }`
      }
    >
      {icon}
      {label}
      {count > 0 && (
        <span className="ml-auto min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-bold leading-none shrink-0">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  )
}

// ── Collapsible section ────────────────────────────────────────────────────
// `withDivider` adds a thin top divider + spacing — set on every section
// after the first to visually separate groups.
// visibleCount: number of visible items in this section (passed by parent)
function NavSection({ id, label, badge, children, defaultOpen = true, withDivider = false, visibleCount = 0 }) {
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(`buddy-nav-${id}`)
    return stored !== null ? stored === 'true' : defaultOpen
  })

  function toggle() {
    const next = !open
    setOpen(next)
    localStorage.setItem(`buddy-nav-${id}`, String(next))
  }

  // Hide the entire section if no visible items
  if (visibleCount === 0) return null

  return (
    <div className={`mb-1 ${withDivider ? 'mt-3 pt-3 border-t border-gray-200 dark:border-white/5' : ''}`}>
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg group transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-600 group-hover:text-gray-500 dark:group-hover:text-slate-500 transition-colors">
            {label}
          </span>
          {badge && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-semibold border border-cyan-500/20">
              {badge}
            </span>
          )}
        </div>
        <span className={`text-gray-300 dark:text-slate-700 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>
          {Icons.chevron}
        </span>
      </button>

      <div className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="space-y-0.5 mt-0.5 pl-3">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Layout ─────────────────────────────────────────────────────────────────
// User identity / role / theme / sign-out / notifications were previously
// pinned to the bottom of the sidebar — they now live in the global header
// (right side: bell + UserMenu). Sidebar is purely navigation.
export default function Layout() {
  const { isAdmin } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [accessibleRoutes, setAccessibleRoutes] = useState(new Set()) // routes user can see
  const [openTaskCount, setOpenTaskCount] = useState(0) // non-closed tasks → nav bubble

  const close = () => setSidebarOpen(false)

  // Keep the Command Center open-count bubble roughly live: on load, whenever the
  // page mutates a task (custom event), and on a gentle interval. Non-blocking.
  useEffect(() => {
    let stale = false
    const refresh = () => countOpenTasks().then(c => { if (!stale && c !== null) setOpenTaskCount(c) })
    refresh()
    window.addEventListener(TASKS_CHANGED_EVENT, refresh)
    const id = setInterval(refresh, 150000) // ~2.5 min
    return () => { stale = true; window.removeEventListener(TASKS_CHANGED_EVENT, refresh); clearInterval(id) }
  }, [])

  useEffect(() => {
    const loadAccessiblePages = async () => {
      try {
        const { data, error } = await supabase.rpc('my_pages')
        if (error) {
          console.error('Failed to load accessible pages:', error)
          return
        }
        const routes = new Set((data || []).map(p => p.route))
        setAccessibleRoutes(routes)
      } catch (e) {
        console.error('Error loading accessible pages:', e)
      }
    }
    loadAccessiblePages()
  }, [])

  // Count visible items per section for hiding empty groups
  const visibleCounts = {
    today: ['/command-center', '/rig', '/fleet/profitability/boardroom', '/fleet/profitability/lanes', '/cash-flow/lifeline'].filter(r => accessibleRoutes.has(r)).length,
    money: ['/cash-flow/payment-calendar', '/financial-controls/debt-schedule', '/financial-controls/driver-purchases'].filter(r => accessibleRoutes.has(r)).length,
    profitability: ['/fleet/profitability', '/fleet/profitability/spotlight', '/fleet/profitability/contribution', '/fleet/profitability/idle', '/fleet/profitability/miles-performance'].filter(r => accessibleRoutes.has(r)).length,
    fleet: ['/fleet/trucks', '/fleet/trailers', '/fleet/drivers', '/fleet/cost', '/fleet/loads/import', '/fleet/settlements/import', '/fleet/combined-loads'].filter(r => accessibleRoutes.has(r)).length,
    payables: ['/dashboard', '/vendors', '/invoices', '/transactions', '/reports'].filter(r => accessibleRoutes.has(r)).length,
  }

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-[#09091a]">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm" onClick={close} />}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-60 bg-white dark:bg-[#0d0d1f] border-r border-gray-200 dark:border-white/5 flex flex-col transform transition-transform duration-300 lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:self-start lg:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>

        {/* Brand */}
        <div className="p-4 border-b border-gray-100 dark:border-white/5">
          <div className="flex items-center gap-3">
            <BuddyLogoSmall className="w-9 h-9" />
            <div>
              <div className="font-black text-gray-900 dark:text-white text-base leading-tight tracking-tight
                text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-fuchsia-500">
                BUDDY
              </div>
              <div className="text-[10px] text-gray-400 dark:text-slate-500 tracking-wide">Manas Express</div>
            </div>
          </div>
        </div>

        {/* Navigation — scrollable middle section */}
        <nav className="flex-1 p-2.5 space-y-3 overflow-y-auto min-h-0">

          {/* TODAY — pinned at top */}
          <NavSection id="today" label="Today" visibleCount={visibleCounts.today}>
            <NavItem to="/command-center" label="Command Center" icon={Icons.command} onClick={close} visible={accessibleRoutes.has('/command-center')} count={openTaskCount} />
            <NavItem to="/rig" label="The Rig" icon={Icons.truck} onClick={close} visible={accessibleRoutes.has('/rig')} />
            <NavItem to="/fleet/profitability/boardroom" label="Boardroom" icon={Icons.boardroom} onClick={close} visible={accessibleRoutes.has('/fleet/profitability/boardroom')} />
            <NavItem to="/fleet/profitability/lanes" label="Lane Map" icon={Icons.map} onClick={close} visible={accessibleRoutes.has('/fleet/profitability/lanes')} />
            <NavItem to="/cash-flow/lifeline" label="Lifeline" icon={Icons.lifeline} onClick={close} visible={accessibleRoutes.has('/cash-flow/lifeline')} />
          </NavSection>

          {/* MONEY */}
          <NavSection id="money" label="Money" withDivider visibleCount={visibleCounts.money}>
            <NavItem to="/cash-flow/payment-calendar" label="Payment Calendar" icon={Icons.calendar} onClick={close} visible={accessibleRoutes.has('/cash-flow/payment-calendar')} />
            <NavItem to="/financial-controls/debt-schedule" label="Debt Schedule" icon={Icons.debt} onClick={close} visible={accessibleRoutes.has('/financial-controls/debt-schedule')} />
            <NavItem to="/financial-controls/driver-purchases" label="Driver Purchases" icon={Icons.driverSale} onClick={close} visible={accessibleRoutes.has('/financial-controls/driver-purchases')} />
          </NavSection>

          {/* PROFITABILITY */}
          <NavSection id="profitability" label="Profitability" withDivider visibleCount={visibleCounts.profitability}>
            <NavItem to="/fleet/profitability" label="Profitability" icon={Icons.cost} end onClick={close} visible={accessibleRoutes.has('/fleet/profitability')} />
            <NavItem to="/fleet/profitability/spotlight" label="Driver Spotlight" icon={Icons.driver} onClick={close} visible={accessibleRoutes.has('/fleet/profitability/spotlight')} />
            <NavItem to="/fleet/profitability/contribution" label="Contribution" icon={Icons.report} onClick={close} visible={accessibleRoutes.has('/fleet/profitability/contribution')} />
            <NavItem to="/fleet/profitability/idle" label="Idle review" icon={Icons.cost} onClick={close} visible={accessibleRoutes.has('/fleet/profitability/idle')} />
            <NavItem to="/fleet/profitability/miles-performance" label="Miles & Performance" icon={Icons.map} onClick={close} visible={accessibleRoutes.has('/fleet/profitability/miles-performance')} />
          </NavSection>

          {/* FLEET */}
          <NavSection id="fleet" label="Fleet" withDivider visibleCount={visibleCounts.fleet}>
            <NavItem to="/fleet/trucks" label="Trucks" icon={Icons.truck} onClick={close} visible={accessibleRoutes.has('/fleet/trucks')} />
            <NavItem to="/fleet/trailers" label="Trailers" icon={Icons.trailer} onClick={close} visible={accessibleRoutes.has('/fleet/trailers')} />
            <NavItem to="/fleet/drivers" label="Drivers" icon={Icons.driver} onClick={close} visible={accessibleRoutes.has('/fleet/drivers')} />
            <NavItem to="/fleet/cost" label="Equipment Cost" icon={Icons.cost} onClick={close} visible={accessibleRoutes.has('/fleet/cost')} />
            <NavItem to="/fleet/loads/import" label="Loads Import" icon={Icons.truck} onClick={close} visible={accessibleRoutes.has('/fleet/loads/import')} />
            <NavItem to="/fleet/settlements/import" label="Settlement Import" icon={Icons.payment} onClick={close} visible={accessibleRoutes.has('/fleet/settlements/import')} />
            <NavItem to="/fleet/combined-loads" label="Combined Loads" icon={Icons.merge} onClick={close} visible={accessibleRoutes.has('/fleet/combined-loads')} />
          </NavSection>

          {/* PAYABLES */}
          <NavSection id="payables" label="Payables" withDivider visibleCount={visibleCounts.payables}>
            <NavItem to="/dashboard" label="Dashboard" icon={Icons.dashboard} onClick={close} visible={accessibleRoutes.has('/dashboard')} />
            <NavItem to="/vendors" label="Vendor Master" icon={Icons.vendors} onClick={close} visible={accessibleRoutes.has('/vendors')} />
            <NavItem to="/invoices" label="Invoice Inbox" icon={Icons.invoices} onClick={close} visible={accessibleRoutes.has('/invoices')} />
            <NavItem to="/transactions" label="Transaction Feed" icon={Icons.txns} onClick={close} visible={accessibleRoutes.has('/transactions')} />
            <NavItem to="/reports" label="Monthly Report" icon={Icons.report} onClick={close} visible={accessibleRoutes.has('/reports')} />
          </NavSection>
        </nav>

        {/* SETTINGS — pinned footer at bottom, admin-only */}
        {isAdmin && (
          <div className="shrink-0 p-2.5 border-t border-gray-200 dark:border-white/5">
            <NavItem to="/settings" label="Settings" icon={Icons.gear} onClick={close} />
          </div>
        )}

      </aside>

      {/* Main column: global header (sticky) + page outlet */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white/90 dark:bg-[#0d0d1f]/90 backdrop-blur border-b border-gray-200 dark:border-white/5 px-4 h-12 flex items-center gap-3">
          {/* Mobile: hamburger + brand. Desktop: brand hidden, breadcrumb slot lives here. */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-white transition-colors"
            title="Open menu"
          >
            {Icons.menu}
          </button>
          <div className="lg:hidden flex items-center gap-2">
            <BuddyLogoSmall className="w-6 h-6" />
            <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-sm">BUDDY</span>
          </div>

          {/* Left side breadcrumb / page-title slot — empty for now, page
              components can fill it via a portal in a future PR. */}
          <div className="flex-1" />

          {/* Right cluster: bell + user menu */}
          <div className="flex items-center gap-1">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
