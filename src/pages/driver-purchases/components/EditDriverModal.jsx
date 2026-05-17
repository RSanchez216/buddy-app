import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import { logEvent } from '../utils/events'
import { useToast } from '../../../contexts/ToastContext'

// Same simplified field set as NewDriverModal — see comment there.

export default function EditDriverModal({ open, onClose, driver, purchaseId, onSaved }) {
  const { user } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && driver) {
      setForm({
        full_name: driver.full_name || '',
        internal_id: driver.internal_id || '',
        phone: driver.phone || '',
        email: driver.email || '',
        notes: driver.notes || '',
      })
      setError('')
    }
  }, [open, driver])

  async function save() {
    if (!form.full_name?.trim()) return setError('Full name is required')
    setSaving(true); setError('')
    const payload = {
      full_name: form.full_name.trim(),
      internal_id: form.internal_id.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
      updated_by: user?.id || null,
    }
    const { error: e } = await supabase.from('drivers').update(payload).eq('id', driver.id)
    setSaving(false)
    if (e) { setError(e.message); toast.error("Couldn't update driver", e); return }
    toast.success(`Driver updated — ${form.full_name}`)
    if (purchaseId) {
      await logEvent(purchaseId, 'driver_updated', `Updated driver ${form.full_name}`, {}, user?.id)
    }
    onSaved?.()
  }

  if (!driver) return null

  return (
    <Modal open={open} onClose={onClose} title={`Edit Driver — ${driver.full_name}`} size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full name *" wide>
            <input className={S.input} value={form.full_name || ''} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <Field label="Internal ID">
            <input className={S.input} value={form.internal_id || ''} onChange={e => setForm(f => ({ ...f, internal_id: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <input className={S.input} value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Email" wide>
            <input className={S.input} type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={S.textarea} rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </Field>
        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>
            {saving ? 'Saving…' : 'Save changes'}
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
