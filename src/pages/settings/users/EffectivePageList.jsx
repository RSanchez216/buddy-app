import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// Read-only view of a user's EFFECTIVE page access, grouped by source, for the
// user detail drawer. Grants are never changed here — "Manage access" stays the
// only writer (two UIs writing the same table would drift). Reads from
// v_user_effective_page_access; pages is joined client-side for display only.

const CHIP = {
  view: 'bg-gray-100 dark:bg-slate-700/50 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-600/30',
  edit: 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20',
}

function AccessChip({ level }) {
  return (
    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${CHIP[level] || CHIP.view}`}>
      {level === 'edit' ? 'Edit' : 'View'}
    </span>
  )
}

function Section({ title, count, rows, muted, note }) {
  return (
    <div className={muted ? 'opacity-70' : ''}>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1.5">{title} · {count}</h4>
      {note && <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-2">{note}</p>}
      <div className="space-y-1">
        {rows.map(r => (
          <div key={r.page_key} className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-white/5 rounded-lg">
            <p className="text-xs min-w-0 truncate">
              <span className="text-gray-400 dark:text-slate-500">{r.nav_group} · </span>
              <span className="text-gray-800 dark:text-slate-200 font-medium">{r.label}</span>
            </p>
            <AccessChip level={r.access_level} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function EffectivePageList({ user }) {
  const [rows, setRows] = useState([])   // combined view+page rows (non-admin)
  const [roleName, setRoleName] = useState(null)
  const [adminCount, setAdminCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const isAdmin = user?.role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (isAdmin) {
        // Admins bypass grants via is_admin() — no list, just the total pages.
        const { count } = await supabase.from('pages').select('page_key', { count: 'exact', head: true })
        setAdminCount(count || 0)
        setRows([])
        return
      }
      const [{ data: effData }, { data: pageData }] = await Promise.all([
        supabase.from('v_user_effective_page_access').select('page_key, access_level, source').eq('user_id', user.id),
        supabase.from('pages').select('page_key, label, nav_group, sort_order'),
      ])
      const meta = new Map((pageData || []).map(p => [p.page_key, p]))
      const combined = (effData || []).map(r => {
        const m = meta.get(r.page_key) || {}
        return { ...r, label: m.label || r.page_key, nav_group: m.nav_group || 'Other', sort_order: m.sort_order ?? 9999 }
      })
      combined.sort((a, b) =>
        (a.nav_group || '').localeCompare(b.nav_group || '') ||
        (a.sort_order - b.sort_order) ||
        (a.label || '').localeCompare(b.label || ''))
      setRows(combined)

      if (user.role_id) {
        const { data: roleRow } = await supabase.from('roles').select('name').eq('id', user.role_id).maybeSingle()
        setRoleName(roleRow?.name || null)
      } else {
        setRoleName(null)
      }
    } finally {
      setLoading(false)
    }
  }, [isAdmin, user?.id, user?.role_id])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => ({
    role: rows.filter(r => r.source === 'role'),
    individual: rows.filter(r => r.source === 'individual'),
    both: rows.filter(r => r.source === 'both'),
  }), [rows])

  const who = user?.full_name || user?.email || 'This user'
  const count = isAdmin ? adminCount : rows.length

  return (
    <div>
      <h3 className="text-xs font-medium text-gray-700 dark:text-slate-400 uppercase tracking-wide mb-2">
        Page access
        {!loading && !isAdmin && (
          <span className="text-gray-400 dark:text-slate-500 normal-case font-normal"> · {count} page{count === 1 ? '' : 's'}</span>
        )}
      </h3>

      {loading ? (
        <div className="flex items-center justify-center h-16"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500" /></div>
      ) : isAdmin ? (
        <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl text-xs text-blue-700 dark:text-blue-400">
          Admin — full access to all {count} pages.
        </div>
      ) : rows.length === 0 ? (
        <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl text-xs text-gray-500 dark:text-slate-400">
          No page access yet. Assign a role from the Role column in the table, or use Manage access to grant individual pages.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.role.length > 0 && (
            <Section title={`From ${roleName || 'role'}`} count={groups.role.length} rows={groups.role} />
          )}
          {groups.individual.length > 0 && (
            <Section title="Individual only" count={groups.individual.length} rows={groups.individual} />
          )}
          {groups.both.length > 0 && (
            <Section
              title="Redundant"
              count={groups.both.length}
              rows={groups.both}
              muted
              note={`The ${roleName || 'assigned'} role already grants these. The individual grants can be removed without changing what ${who} can see.`}
            />
          )}
        </div>
      )}
    </div>
  )
}
