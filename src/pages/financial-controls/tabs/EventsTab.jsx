import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { FC, EVENT_TYPES, STATUS_LABELS, fmtMoney, fmtDate } from '../loanUtils'

const empty = { event_date: '', event_type: 'note', amount: '', description: '' }

function eventColor(type) {
  switch (type) {
    case 'paydown':            return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    case 'restructure':        return 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400'
    case 'rate_change':        return 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400'
    case 'balance_correction': return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'
    case 'transfer':           return 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400'
    case 'note':               return 'bg-gray-100 dark:bg-slate-700/50 text-gray-700 dark:text-slate-300'
    default:                   return 'bg-gray-100 dark:bg-slate-700/50 text-gray-700 dark:text-slate-300'
  }
}

export default function EventsTab({ loanId, canEdit }) {
  const { user } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() /* eslint-disable-line */ }, [loanId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('loan_events')
      .select('*, creator:users!loan_events_created_by_fkey(full_name)')
      .eq('loan_id', loanId)
      .order('event_date', { ascending: false })
    setEvents(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditItem(null)
    setForm({ ...empty, event_date: new Date().toISOString().slice(0, 10) })
    setError(''); setShowModal(true)
  }

  function openEdit(e) {
    setEditItem(e)
    setForm({
      event_date: e.event_date || '',
      event_type: e.event_type,
      amount: e.amount ?? '',
      description: e.description || '',
    })
    setError(''); setShowModal(true)
  }

  async function save() {
    if (!form.event_date) return setError('Event date is required')
    if (!form.description.trim()) return setError('Description is required')
    setSaving(true); setError('')
    const payload = {
      loan_id: loanId,
      event_date: form.event_date,
      event_type: form.event_type,
      amount: form.amount === '' ? null : Number(form.amount),
      description: form.description.trim(),
    }
    const res = editItem
      ? await supabase.from('loan_events').update(payload).eq('id', editItem.id)
      : await supabase.from('loan_events').insert({ ...payload, created_by: user?.id || null })
    if (res.error) setError(res.error.message)
    else { setShowModal(false); load() }
    setSaving(false)
  }

  async function remove(e) {
    if (!confirm('Delete this event?')) return
    await supabase.from('loan_events').delete().eq('id', e.id)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <button onClick={openAdd} className={FC.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Event
          </button>
        </div>
      )}

      <div className={`${S.card} p-5`}>
        {events.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-600 text-sm py-12">No events recorded</p>
        ) : (
          <ul className="space-y-3">
            {events.map(ev => (
              <li key={ev.id} className="flex items-start gap-3 pb-3 border-b border-gray-100 dark:border-white/5 last:border-0 last:pb-0">
                <div className="w-2 h-2 rounded-full bg-orange-400 mt-2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${eventColor(ev.event_type)}`}>
                      {STATUS_LABELS[ev.event_type] || ev.event_type}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-slate-500">{fmtDate(ev.event_date)}</span>
                    {ev.amount != null && (
                      <span className="text-xs font-mono font-semibold text-gray-700 dark:text-slate-300">{fmtMoney(ev.amount)}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-slate-300">{ev.description}</p>
                  <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{ev.creator?.full_name || ''}</p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => openEdit(ev)} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400" title="Edit">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => remove(ev)} className="text-gray-400 hover:text-red-500" title="Delete">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Event' : 'Add Event'} size="md">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Event Date *">
              <input className={S.input} type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
            </Field>
            <Field label="Event Type">
              <Select value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                {EVENT_TYPES.map(t => <option key={t} value={t}>{STATUS_LABELS[t] || t}</option>)}
              </Select>
            </Field>
            <Field label="Amount ($)">
              <input className={S.input} type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </Field>
          </div>
          <Field label="Description *">
            <textarea className={S.textarea} rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </Field>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={save} disabled={saving} className={FC.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add Event'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className={S.label}>{label}</label>
      {children}
    </div>
  )
}
