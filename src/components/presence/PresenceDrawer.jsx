import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePresenceContext } from '../../contexts/PresenceProvider'
import { usePageAccess } from '../../contexts/PageAccessContext'
import { supabase } from '../../lib/supabase'
import { avatarColor, initials } from '../../lib/presenceColor'

const DAY_MS = 24 * 60 * 60 * 1000

// "last active" — never "last login". Reads from users.last_seen_at.
function lastActiveLabel(ts, now) {
  if (!ts) return 'never'
  const diff = now - new Date(ts).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `last active ${m}m ago`
  const h = Math.round(m / 60)
  if (diff < DAY_MS) return `last active ${h}h ago`
  const d = Math.round(diff / DAY_MS)
  if (d < 7) return `last active ${d}d ago`
  return `last active ${new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

function titleCase(seg) {
  return seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function Row({ id, name, colorId, right, sub, dot, you }) {
  const c = avatarColor(colorId || id)
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-gray-100 dark:border-white/5">
      <div className="relative shrink-0">
        <div
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[13px] font-medium"
          style={{ background: c.bg, color: c.fg }}
        >
          {initials(name)}
        </div>
        {dot && (
          <span
            className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#0d0d1f]"
            style={{ background: dot }}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-gray-900 dark:text-slate-100 truncate">
          {name}
          {you && <span className="text-gray-400 dark:text-slate-500 font-normal"> · you</span>}
        </div>
        {sub && <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{sub}</div>}
      </div>
      {right && <span className="text-[11px] text-gray-400 dark:text-slate-500 whitespace-nowrap">{right}</span>}
    </div>
  )
}

function SectionHeader({ label }) {
  return <div className="px-3.5 pt-3 pb-1.5 text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</div>
}

export default function PresenceDrawer({ open, onClose }) {
  const { me, roster } = usePresenceContext()
  const { pages } = usePageAccess()
  const [dbRows, setDbRows] = useState([])
  const [now, setNow] = useState(() => Date.now()) // snapshot clock for relative labels

  useEffect(() => {
    if (!open) return
    let cancelled = false
    supabase.rpc('list_presence_roster').then(({ data, error }) => {
      if (cancelled) return
      if (error) { console.warn('list_presence_roster failed', error.message); return }
      setDbRows(data || [])
      setNow(Date.now()) // fresh clock alongside fresh data (async callback — not in render)
    })
    return () => { cancelled = true }
  }, [open])

  // Keep relative labels ("3h ago") current while the drawer stays open.
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(id)
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Map a pathname to a friendly page name using the sidebar's own labels;
  // fall back to the last path segment, title-cased.
  const pageLabel = useMemo(() => {
    const norm = (s) => String(s || '').replace(/^\/+|\/+$/g, '')
    return (route) => {
      if (!route) return null
      const path = norm(route)
      let best = null
      for (const p of pages) {
        const pr = norm(p.route)
        if (!pr) continue
        if ((path === pr || path.startsWith(pr + '/')) && (!best || pr.length > norm(best.route).length)) best = p
      }
      if (best) return best.label
      const seg = path.split('/').filter(Boolean).pop()
      return seg ? titleCase(seg) : 'Home'
    }
  }, [pages])

  const { online, awayToday, inactive } = useMemo(() => {
    const onlineIds = new Set(roster.map((r) => r.user_id))
    if (me) onlineIds.add(me.id)
    const online = [
      ...(me ? [{ user_id: me.id, full_name: me.full_name, status: 'active', route: null, isMe: true }] : []),
      ...roster,
    ]
    const offline = dbRows.filter((u) => !onlineIds.has(u.id))
    const awayToday = offline.filter((u) => u.last_seen_at && now - new Date(u.last_seen_at).getTime() < DAY_MS)
    const inactive = offline.filter((u) => !u.last_seen_at || now - new Date(u.last_seen_at).getTime() >= DAY_MS)
    return { online, awayToday, inactive }
  }, [roster, dbRows, me, now])

  if (!open) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80] bg-black/30 dark:bg-black/50" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[90] h-full w-[320px] max-w-[92vw] bg-white dark:bg-[#0d0d1f] border-l border-gray-200 dark:border-white/10 shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-3.5 py-3 border-b border-gray-200 dark:border-white/10 sticky top-0 bg-white dark:bg-[#0d0d1f] z-10">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: '#1D9E75' }} />
            <span className="text-sm font-medium text-gray-900 dark:text-slate-100">Online now</span>
            <span className="text-xs text-gray-400 dark:text-slate-500 tabular-nums">{online.length}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-slate-200 dark:hover:bg-white/5 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        {online.map((u) => (
          <Row
            key={u.user_id}
            id={u.user_id}
            name={u.full_name}
            you={u.isMe}
            dot={u.status === 'active' ? '#1D9E75' : '#B4B2A9'}
            sub={u.isMe ? null : (u.route ? pageLabel(u.route) : null)}
            right={u.isMe ? null : (u.status === 'active' ? 'active' : 'idle')}
          />
        ))}

        {awayToday.length > 0 && (
          <>
            <SectionHeader label="Away today" />
            {awayToday.map((u) => (
              <Row key={u.id} id={u.id} name={u.full_name} right={lastActiveLabel(u.last_seen_at, now)} />
            ))}
          </>
        )}

        {inactive.length > 0 && (
          <>
            <SectionHeader label="Inactive" />
            {inactive.map((u) => (
              <Row key={u.id} id={u.id} name={u.full_name} right={lastActiveLabel(u.last_seen_at, now)} />
            ))}
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
