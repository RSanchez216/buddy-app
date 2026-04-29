import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'

export default function NotesTab({ loan, canEdit, onChange }) {
  const [description, setDescription] = useState(loan.description || '')
  const [cfoFlag, setCfoFlag] = useState(!!loan.cfo_flag)
  const [savedAt, setSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDescription(loan.description || ''); setCfoFlag(!!loan.cfo_flag) }, [loan])

  async function saveDescription() {
    if (!canEdit) return
    if ((loan.description || '') === description) return
    setSaving(true)
    const { error } = await supabase.from('loans').update({
      description: description || null,
      updated_at: new Date().toISOString(),
    }).eq('id', loan.id)
    setSaving(false)
    if (!error) { setSavedAt(new Date()); onChange?.() }
  }

  async function toggleCfo(checked) {
    if (!canEdit) return
    setCfoFlag(checked)
    const { error } = await supabase.from('loans').update({
      cfo_flag: checked,
      updated_at: new Date().toISOString(),
    }).eq('id', loan.id)
    if (!error) { setSavedAt(new Date()); onChange?.() }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className={`${S.card} p-5 space-y-4`}>
        <div className="flex items-center justify-between">
          <label className={S.label}>Notes / Description</label>
          <div className="flex items-center gap-3">
            {saving && <span className="text-xs text-gray-400 dark:text-slate-500">Saving…</span>}
            {savedAt && !saving && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                Saved {savedAt.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        <textarea
          className={S.textarea}
          rows={12}
          disabled={!canEdit}
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={saveDescription}
          placeholder="Internal notes about this loan…"
        />
        <p className="text-xs text-gray-400 dark:text-slate-500">Autosaves on blur.</p>

        <label className="flex items-center gap-3 pt-3 border-t border-gray-100 dark:border-white/5">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={cfoFlag}
            onChange={e => toggleCfo(e.target.checked)}
            className="rounded"
          />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-slate-200">Flag for CFO review</p>
            <p className="text-xs text-gray-500 dark:text-slate-500">Surface this loan in CFO-level reporting</p>
          </div>
        </label>
      </div>
    </div>
  )
}
