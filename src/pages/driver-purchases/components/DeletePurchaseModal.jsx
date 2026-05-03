import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import { fmtMoney } from '../utils/format'

const BUCKET = 'driver-documents'

export default function DeletePurchaseModal({ open, onClose, purchase, onDeleted }) {
  const [counts, setCounts] = useState({ payments: 0, events: 0, docs: 0 })
  const [docPaths, setDocPaths] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !purchase) return
    let cancelled = false
    async function load() {
      setError('')
      const [pRes, eRes, dRes] = await Promise.all([
        supabase.from('driver_purchase_payments').select('id', { count: 'exact', head: true }).eq('driver_purchase_id', purchase.id),
        supabase.from('driver_purchase_events').select('id', { count: 'exact', head: true }).eq('driver_purchase_id', purchase.id),
        supabase.from('driver_purchase_documents').select('file_path').eq('driver_purchase_id', purchase.id),
      ])
      if (cancelled) return
      setCounts({
        payments: pRes.count || 0,
        events: eRes.count || 0,
        docs: dRes.data?.length || 0,
      })
      setDocPaths((dRes.data || []).map(d => d.file_path).filter(Boolean))
    }
    load()
    return () => { cancelled = true }
  }, [open, purchase])

  async function confirmDelete() {
    if (!purchase) return
    setBusy(true); setError('')
    // Storage cleanup first (best-effort) — DB cascade handles row deletion
    if (docPaths.length) {
      const { error: rmError } = await supabase.storage.from(BUCKET).remove(docPaths)
      if (rmError) console.warn('Storage cleanup warning:', rmError.message)
    }
    const { error: e } = await supabase.from('driver_purchases').delete().eq('id', purchase.id)
    setBusy(false)
    if (e) { setError(e.message); return }
    onDeleted?.()
  }

  if (!purchase) return null
  const balance = Number(purchase.current_balance || 0)

  return (
    <Modal open={open} onClose={onClose} title="Delete this driver purchase?" size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          This will permanently delete the contract, <span className="font-semibold">{counts.payments}</span> payment record{counts.payments === 1 ? '' : 's'},{' '}
          <span className="font-semibold">{counts.events}</span> event{counts.events === 1 ? '' : 's'}, and{' '}
          <span className="font-semibold">{counts.docs}</span> document{counts.docs === 1 ? '' : 's'}.
          The driver record itself will not be deleted.
        </p>

        {balance > 0 && (
          <div className="rounded-xl p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-sm text-amber-700 dark:text-amber-400">
            ⚠ This contract still has <span className="font-mono font-semibold">{fmtMoney(balance)}</span> owed. Are you sure?
          </div>
        )}

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel} disabled={busy}>Cancel</button>
          <button
            onClick={confirmDelete}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-red-500 hover:bg-red-400 disabled:opacity-60 text-white rounded-xl transition-all"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
