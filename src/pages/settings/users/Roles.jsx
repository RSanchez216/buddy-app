import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'
import { ROLE_CHIP, slugifyRoleKey } from './userUtils'
import RoleEditor from './RoleEditor'

const ORANGE_BTN = 'flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20'

export default function Roles() {
  const toast = useToast()
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: rolesData, error: rErr }, { data: memberRows, error: mErr }, { data: pageRows, error: pErr }] = await Promise.all([
        supabase.from('roles').select('id, key, name, description, is_active, sort_order').order('sort_order'),
        supabase.from('users').select('role_id'),
        supabase.from('role_page_access').select('role_id'),
      ])
      if (rErr) throw new Error(rErr.message)
      if (mErr) throw new Error(mErr.message)
      if (pErr) throw new Error(pErr.message)

      const memberCount = {}, pageCount = {}
      for (const u of memberRows || []) if (u.role_id) memberCount[u.role_id] = (memberCount[u.role_id] || 0) + 1
      for (const p of pageRows || []) pageCount[p.role_id] = (pageCount[p.role_id] || 0) + 1

      const enriched = (rolesData || []).map(r => ({
        ...r,
        members: memberCount[r.id] || 0,
        pages: pageCount[r.id] || 0,
      }))
      // Active first (by sort_order), inactive last.
      enriched.sort((a, b) => (a.is_active === b.is_active) ? (a.sort_order - b.sort_order) : (a.is_active ? -1 : 1))
      setRoles(enriched)
    } catch (e) {
      toast.error('Failed to load roles', e)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const totalMembers = roles.reduce((n, r) => n + r.members, 0)

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Roles</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            {roles.length} role{roles.length === 1 ? '' : 's'} · {totalMembers} {totalMembers === 1 ? 'person' : 'people'} assigned
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className={ORANGE_BTN}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create role
        </button>
      </div>

      <div className={`${S.card} divide-y divide-gray-100 dark:divide-white/5 overflow-hidden`}>
        {roles.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-slate-600 text-sm">No roles yet</div>
        ) : roles.map(r => (
          <button
            key={r.id}
            onClick={() => setEditingRoleId(r.id)}
            className={`w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${r.is_active ? '' : 'opacity-60'}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_CHIP}`}>{r.name}</span>
              {!r.is_active && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30">Inactive</span>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-gray-500 dark:text-slate-400">
                {r.members} {r.members === 1 ? 'person' : 'people'} · {r.pages} page{r.pages === 1 ? '' : 's'}
              </span>
              <svg className="w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      {editingRoleId && (
        <RoleEditor
          roleId={editingRoleId}
          onClose={() => setEditingRoleId(null)}
          onSaved={load}
        />
      )}
      {showCreate && (
        <CreateRoleModal
          existingSortOrders={roles.map(r => r.sort_order)}
          onClose={() => setShowCreate(false)}
          onCreated={(newId) => { setShowCreate(false); load(); setEditingRoleId(newId) }}
        />
      )}
    </div>
  )
}

function CreateRoleModal({ existingSortOrders, onClose, onCreated }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const key = slugifyRoleKey(name)

  async function create() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!key) { setError('Enter a name with at least one letter or number'); return }
    setSaving(true)
    setError('')
    const nextSort = (existingSortOrders.length ? Math.max(...existingSortOrders) : 0) + 10
    const { data, error: insErr } = await supabase.from('roles')
      .insert({
        key,
        name: name.trim(),
        description: description.trim() || null,
        is_active: true,
        sort_order: nextSort,
        created_by: (await supabase.auth.getUser()).data.user?.id,
      })
      .select('id')
      .single()
    setSaving(false)
    if (insErr) {
      if (/duplicate|unique|already exists|23505/i.test(insErr.message)) {
        setError('A role with a similar name already exists — pick a different name.')
      } else {
        setError(insErr.message)
      }
      return
    }
    toast.success(`Role "${name.trim()}" created`)
    onCreated(data.id)
  }

  return createPortal(
    <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Create role</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Name</label>
            <input className={S.input} value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Dispatch" />
            {key && <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 font-mono">key: {key}</p>}
          </div>
          <div>
            <label className={S.label}>Description</label>
            <input className={S.input} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400">New roles start with no pages — you'll set them next.</p>
        </div>
        <div className="border-t border-gray-100 dark:border-white/5 p-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={create} disabled={saving} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">
            {saving ? 'Creating…' : 'Create & edit'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
