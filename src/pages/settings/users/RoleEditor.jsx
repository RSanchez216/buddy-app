import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'

// Role editor — name/description/is_active plus a per-page three-way grant grid.
// Page-cell changes upsert/delete role_page_access immediately; resolution is
// live, so every member of the role is affected the instant a cell changes.
// Only shareable pages are loaded, which keeps unfinished pages out of roles.

const ORANGE = '#F97316'

// Three-way access control: — (none) · V (view) · E (edit). Active = orange.
function AccessToggle({ value, onChange, disabled }) {
  const opts = [{ v: 'none', l: '—' }, { v: 'view', l: 'V' }, { v: 'edit', l: 'E' }]
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700">
      {opts.map(o => {
        const active = (o.v === 'none' && !value) || value === o.v
        return (
          <button
            key={o.v}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={`px-2.5 py-1 text-xs font-semibold transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${
              active ? 'text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
            }`}
            style={active ? { background: ORANGE } : undefined}
            title={o.v === 'none' ? 'No access' : o.v === 'view' ? 'View' : 'Edit'}
          >
            {o.l}
          </button>
        )
      })}
    </div>
  )
}

export default function RoleEditor({ roleId, onClose, onSaved }) {
  const toast = useToast()
  const [role, setRole] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [pages, setPages] = useState([])
  const [access, setAccess] = useState({}) // page_key -> 'view' | 'edit'
  const [members, setMembers] = useState(0)
  const [loading, setLoading] = useState(true)
  const [savingMeta, setSavingMeta] = useState(false)
  const [busyCell, setBusyCell] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [{ data: roleRow, error: rErr }, { data: pageRows, error: pErr }, { data: accessRows, error: aErr }, { count, error: mErr }] = await Promise.all([
        supabase.from('roles').select('id, key, name, description, is_active, sort_order').eq('id', roleId).single(),
        supabase.from('pages').select('page_key, label, nav_group, sort_order').eq('is_shareable', true).order('nav_group').order('sort_order'),
        supabase.from('role_page_access').select('page_key, access_level').eq('role_id', roleId),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role_id', roleId),
      ])
      if (rErr) throw new Error(rErr.message)
      if (pErr) throw new Error(pErr.message)
      if (aErr) throw new Error(aErr.message)
      if (mErr) throw new Error(mErr.message)
      setRole(roleRow)
      setName(roleRow.name || '')
      setDescription(roleRow.description || '')
      setIsActive(roleRow.is_active)
      setPages(pageRows || [])
      const map = {}
      for (const r of accessRows || []) map[r.page_key] = r.access_level
      setAccess(map)
      setMembers(count || 0)
    } catch (e) {
      setError(e?.message || 'Failed to load role')
    } finally {
      setLoading(false)
    }
  }, [roleId])

  useEffect(() => { load() }, [load])

  const pagesByGroup = useMemo(() => {
    const groups = {}
    for (const p of pages) {
      const g = p.nav_group || 'Other'
      if (!groups[g]) groups[g] = []
      groups[g].push(p)
    }
    return groups
  }, [pages])

  const grantedCount = useMemo(() => Object.keys(access).length, [access])

  async function updateCell(pageKey, level) {
    setBusyCell(pageKey)
    setError('')
    try {
      if (level === 'none') {
        const { error: delErr } = await supabase.from('role_page_access').delete().match({ role_id: roleId, page_key: pageKey })
        if (delErr) throw new Error(delErr.message)
        setAccess(prev => { const next = { ...prev }; delete next[pageKey]; return next })
      } else {
        const { error: upErr } = await supabase.from('role_page_access').upsert({
          role_id: roleId,
          page_key: pageKey,
          access_level: level,
          granted_by: (await supabase.auth.getUser()).data.user?.id,
          granted_at: new Date().toISOString(),
        }, { onConflict: 'role_id,page_key' })
        if (upErr) throw new Error(upErr.message)
        setAccess(prev => ({ ...prev, [pageKey]: level }))
      }
      onSaved?.()
    } catch (e) {
      setError(e?.message || 'Failed to update page access')
      toast.error("Couldn't update page access", e)
    } finally {
      setBusyCell(null)
    }
  }

  async function saveMeta() {
    if (!name.trim()) { setError('Name is required'); return }
    setSavingMeta(true)
    setError('')
    const { error: upErr } = await supabase.from('roles')
      .update({ name: name.trim(), description: description.trim() || null })
      .eq('id', roleId)
    setSavingMeta(false)
    if (upErr) { setError(upErr.message); toast.error("Couldn't save role", upErr); return }
    toast.success('Role saved')
    onSaved?.()
  }

  async function toggleActive() {
    const next = !isActive
    if (!next && members > 0 &&
      !confirm(`Deactivate "${name}"? Its ${members} member${members === 1 ? '' : 's'} will immediately lose this role's pages (they keep any individual grants and stay assigned to the role).`)) {
      return
    }
    const { error: upErr } = await supabase.from('roles').update({ is_active: next }).eq('id', roleId)
    if (upErr) { setError(upErr.message); toast.error("Couldn't update role", upErr); return }
    setIsActive(next)
    toast.success(next ? 'Role activated' : 'Role deactivated')
    onSaved?.()
  }

  async function deleteRole() {
    if (members > 0) {
      setError(`This role has ${members} ${members === 1 ? 'person' : 'people'}. Reassign them first, or deactivate the role instead.`)
      return
    }
    if (!confirm(`Delete the "${name}" role? This can't be undone.`)) return
    const { error: delErr } = await supabase.from('roles').delete().eq('id', roleId)
    if (delErr) {
      // ON DELETE RESTRICT — a race where members were assigned since load.
      if (/restrict|foreign key|violates/i.test(delErr.message)) {
        setError(`This role has people assigned. Reassign them first, or deactivate the role instead.`)
      } else {
        setError(delErr.message)
      }
      toast.error("Couldn't delete role", delErr)
      return
    }
    toast.success('Role deleted')
    onSaved?.()
    onClose?.()
  }

  return createPortal(
    <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Edit role</h3>
            {role && <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 font-mono">{role.key}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 p-5 space-y-5">
            {error && <div className={S.errorBox}>{error}</div>}

            <div className="space-y-3">
              <div>
                <label className={S.label}>Name</label>
                <input className={S.input} value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label className={S.label}>Description</label>
                <input className={S.input} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-slate-200">Active</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Inactive roles grant no pages, but members stay assigned.</p>
                </div>
                <button
                  type="button"
                  onClick={toggleActive}
                  className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors ${isActive ? 'bg-orange-500' : 'bg-gray-300 dark:bg-slate-600'}`}
                  title={isActive ? 'Deactivate role' : 'Activate role'}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="flex justify-end">
                <button onClick={saveMeta} disabled={savingMeta} className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-lg transition-colors">
                  {savingMeta ? 'Saving…' : 'Save details'}
                </button>
              </div>
            </div>

            {members > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl text-xs text-amber-700 dark:text-amber-400">
                {members} {members === 1 ? 'person' : 'people'} will be affected by page changes below — resolution is live.
              </div>
            )}

            <div className="border-t border-gray-100 dark:border-white/5 pt-4 space-y-6">
              {Object.entries(pagesByGroup).map(([group, groupPages]) => (
                <div key={group}>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-3">{group}</h4>
                  <div className="space-y-2">
                    {groupPages.map(page => {
                      const level = access[page.page_key]
                      return (
                        <div key={page.page_key} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-lg">
                          <p className={`text-sm font-medium min-w-0 flex-1 ${level ? 'text-gray-900 dark:text-slate-200' : 'text-gray-400 dark:text-slate-500'}`}>{page.label}</p>
                          <div className="ml-3">
                            <AccessToggle
                              value={level}
                              disabled={busyCell === page.page_key}
                              onChange={lvl => updateCell(page.page_key, lvl)}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-gray-100 dark:border-white/5 p-4 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500 dark:text-slate-400">Only shareable pages can be granted</span>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-600 dark:text-slate-300">{grantedCount} page{grantedCount === 1 ? '' : 's'} granted</span>
            <button onClick={deleteRole} className="px-3 py-1.5 text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
              Delete
            </button>
            <button onClick={onClose} className={S.btnCancel}>Done</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
