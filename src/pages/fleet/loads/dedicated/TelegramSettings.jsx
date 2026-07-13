import { useEffect, useState } from 'react'

// Editable recipient list for the Telegram message footer (scope='global').
// Managers/admins edit; everyone else sees a read-only view. Handles are stored
// verbatim — no leading '@' is forced (e.g. "Kody").
export default function TelegramSettings({ recipients = [], canEdit, onSave }) {
  const [list, setList] = useState(recipients)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-sync when the persisted list changes (e.g. after a save/reload).
  useEffect(() => { setList(recipients) }, [recipients])

  const dirty = list.length !== recipients.length || list.some((h, i) => h !== recipients[i])
  const add = () => {
    const v = input.trim()
    if (!v || list.includes(v)) { setInput(''); return }
    setList(l => [...l, v]); setInput('')
  }
  const remove = (h) => setList(l => l.filter(x => x !== h))
  const save = async () => { setSaving(true); try { await onSave(list) } finally { setSaving(false) } }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400">Telegram recipients</span>
        {!canEdit && <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">read-only</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {list.length === 0 && <span className="text-[12px] text-gray-400 dark:text-slate-500">No recipients set.</span>}
        {list.map(h => (
          <span key={h} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-slate-300 text-[12px] font-semibold">
            {h}
            {canEdit && <button onClick={() => remove(h)} className="hover:text-red-500 dark:hover:text-red-400" aria-label={`Remove ${h}`}>✕</button>}
          </span>
        ))}
      </div>

      {canEdit && (
        <>
          <div className="flex items-center gap-2">
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder="add handle (e.g. @Fleet_Depart or Kody)"
              className="flex-1 px-2.5 py-1.5 text-[12px] bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
            <button onClick={add} disabled={!input.trim()}
              className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40">Add</button>
          </div>
          <button onClick={save} disabled={!dirty || saving}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? 'Saving…' : 'Save recipients'}
          </button>
        </>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1">Message footer preview</div>
        <pre className="text-[11px] text-gray-600 dark:text-slate-400 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-words font-mono">{list.join(' ') || '—'}</pre>
      </div>
    </div>
  )
}
