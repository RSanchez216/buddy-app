import { useEffect, useState } from 'react'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'
import { fetchHandoffText, endShift, copyText, shiftName, pdfSafeText } from './shiftBoardData'

// End-shift handoff. The Telegram block comes from shift_handoff_text (already
// formatted server-side — we show it verbatim, never rebuild it in JS), then
// end_shift freezes that exact text on the record.
export default function EndShiftModal({ open, shift, users = [], onClose, onEnded }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [handedTo, setHandedTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !shift?.id) return
    let stale = false
    setLoading(true); setError(''); setNotes(''); setHandedTo(''); setBusy(false)
    fetchHandoffText(shift.id)
      .then(t => { if (!stale) setText(t || '') })
      .catch(() => { if (!stale) setError("Couldn't load the handoff text.") })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [open, shift?.id])

  if (!open) return null

  async function copy() {
    try { await copyText(text); toast.success('Handoff copied for Telegram') }
    catch (e) { toast.error("Couldn't copy", e) }
  }

  async function downloadPdf() {
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      doc.setFont('courier', 'normal'); doc.setFontSize(10)
      const M = 40, width = doc.internal.pageSize.getWidth() - 2 * M
      const pageH = doc.internal.pageSize.getHeight()
      // Strip emoji/dingbats the WinAnsi built-in font can't render (Telegram keeps them).
      const lines = doc.splitTextToSize(pdfSafeText(text), width)
      let y = 50
      for (const ln of lines) {
        if (y > pageH - 40) { doc.addPage(); y = 50 }
        doc.text(ln, M, y); y += 14
      }
      doc.save(`After Hours Handoff - ${shiftName(shift.shift_type)}.pdf`)
    } catch (e) {
      toast.error("Couldn't build the PDF", e)
    }
  }

  async function confirmEnd() {
    setBusy(true); setError('')
    try {
      await endShift(shift.id, notes.trim() || null, text || null, handedTo || null)
      toast.success('Shift ended & handoff frozen')
      onEnded?.()
    } catch (e) {
      setError(e?.message || 'Failed to end shift.')
      toast.error("Couldn't end the shift", e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0B1120] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">End shift &amp; hand off</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {error && <div className={S.errorBox}>{error}</div>}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={S.label}>Handoff for Telegram</label>
              <div className="flex items-center gap-2">
                <button onClick={copy} disabled={loading || !text} className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline disabled:opacity-40">Copy for Telegram</button>
                <button onClick={downloadPdf} disabled={loading || !text} className="text-xs font-medium text-gray-500 dark:text-slate-400 hover:underline disabled:opacity-40">Download PDF</button>
              </div>
            </div>
            {loading ? (
              <div className="h-40 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap text-gray-800 dark:text-slate-200 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg p-3 max-h-72 overflow-y-auto">{text || 'No handoff text.'}</pre>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={S.label}>Hand off to <span className="font-normal normal-case text-gray-400">(optional)</span></label>
              <select className={S.input} value={handedTo} onChange={e => setHandedTo(e.target.value)}>
                <option value="">— nobody —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Shift notes <span className="font-normal normal-case text-gray-400">(optional)</span></label>
              <input className={S.input} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything for the record…" />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-white/5 p-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={S.btnCancel}>Cancel</button>
          <button onClick={confirmEnd} disabled={busy || loading} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-all">
            {busy ? 'Ending…' : 'End shift & hand off'}
          </button>
        </div>
      </div>
    </div>
  )
}
