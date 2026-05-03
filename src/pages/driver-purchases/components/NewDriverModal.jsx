import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'

// ID type / number / issuing authority / expiration / DOB are intentionally
// omitted from this modal (and EditDriverModal). Driver ID info is captured
// via document uploads (driver_documents) instead. The columns still exist
// on the drivers table so they can be re-surfaced later without a migration.
const empty = {
  full_name: '', internal_id: '', phone: '', email: '', notes: '',
}

export default function NewDriverModal({ open, onClose, onCreated, prefillName = '' }) {
  const { user } = useAuth()
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm({ ...empty, full_name: prefillName || '' })
      setError('')
    }
  }, [open, prefillName])

  async function save() {
    if (!form.full_name.trim()) return setError('Full name is required')
    setSaving(true); setError('')
    const payload = {
      full_name: form.full_name.trim(),
      internal_id: form.internal_id.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
      updated_by: user?.id || null,
    }
    const { data, error: e } = await supabase
      .from('drivers')
      .insert(payload)
      .select('id, full_name, internal_id, phone')
      .single()
    setSaving(false)
    if (e) { setError(e.message); return }
    onCreated?.(data)
  }

  return (
    <Modal open={open} onClose={onClose} title="New Driver" size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full name *" wide>
            <input className={S.input} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} autoFocus />
          </Field>
          <Field label="Internal ID">
            <input className={S.input} value={form.internal_id} onChange={e => setForm(f => ({ ...f, internal_id: e.target.value }))} placeholder="e.g. 1462" />
          </Field>
          <Field label="Phone">
            <input className={S.input} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Email" wide>
            <input className={S.input} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </Field>
        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>
            {saving ? 'Saving…' : 'Create driver'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children, wide }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className={S.label}>{label}</label>
      {children}
    </div>
  )
}
