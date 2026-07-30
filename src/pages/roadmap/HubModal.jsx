import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { S } from '../../lib/styles'
import { updateSettings } from './roadmapData'

export default function HubModal({ open, onClose, settings, onSaved }) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [pageSubtitle, setPageSubtitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(settings?.hub_title || ''); setSubtitle(settings?.hub_subtitle || ''); setPageSubtitle(settings?.page_subtitle || '')
    setError('')
  }, [open, settings])

  async function save() {
    setSaving(true); setError('')
    try {
      await updateSettings({ hub_title: title.trim(), hub_subtitle: subtitle.trim(), page_subtitle: pageSubtitle.trim() })
      onSaved?.(); onClose()
    } catch (e) { setError(e?.message || 'Save failed') } finally { setSaving(false) }
  }

  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title="The destination" size="md">
      <div className={`${S.modalBody} space-y-4`}>
        {error && <div className={S.errorBox}>{error}</div>}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-slate-500 mb-1">Hub title</label>
          <input className={S.input} value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-slate-500 mb-1">Hub subtitle</label>
          <textarea className={S.textarea} rows={2} value={subtitle} onChange={e => setSubtitle(e.target.value)} />
          <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">Wraps to two centred lines under the hub.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-slate-500 mb-1">Page subtitle</label>
          <textarea className={S.textarea} rows={2} value={pageSubtitle} onChange={e => setPageSubtitle(e.target.value)} />
        </div>
        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}
