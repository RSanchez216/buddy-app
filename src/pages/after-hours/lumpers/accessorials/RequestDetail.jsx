import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '../../../../lib/styles'
import { money, fmtDate, fmtChicagoTs } from '../lumperData'
import {
  RESPONSES, statusMeta, typeLabel, docTypeLabel,
  fetchAccessorialDocs, signedDocUrl, recordBrokerResponse, confirmCollected,
  basisText, filingMeta, awaitingMeta,
} from './accountingData'
import { ConfirmCollectedModal } from './SoftMatchStrip'

// One accessorial request, with the two things Accounting does to it: record what the broker
// said (the same RPC the night team uses, for replies that land during the day)
// and confirm the money arrived. Collection is the only gated action, and the
// gate lives on the server — we show the refusal rather than hiding the button.

export default function RequestDetail({ row, focusDocs, onClose, onChanged, toast }) {
  const [docs, setDocs] = useState(null)
  const [showDocs, setShowDocs] = useState(!!focusDocs)
  const [replying, setReplying] = useState(false)
  const [response, setResponse] = useState('approved')
  const [approved, setApproved] = useState('')
  const [respNote, setRespNote] = useState('')
  const [collecting, setCollecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const meta = statusMeta(row.status)
  const collected = row.status === 'collected'
  const needsAmount = !!RESPONSES.find(r => r.value === response)?.needsAmount
  const filing = filingMeta(row.filing_lag_days)
  const awaiting = awaitingMeta(row.days_awaiting)
  const basis = basisText(row)

  const loadDocs = useCallback(async () => {
    try { setDocs(await fetchAccessorialDocs(row.id)) }
    catch (e) { toast?.error("Couldn't load the documents", e) }
  }, [row.id, toast])

  useEffect(() => { if (showDocs && docs == null) loadDocs() }, [showDocs, docs, loadDocs])

  async function openDoc(path) {
    try {
      const url = await signedDocUrl(path) // private bucket — signed URL only
      if (url) window.open(url, '_blank', 'noopener')
    } catch (e) { toast?.error("Couldn't open the document", e) }
  }

  async function submitResponse() {
    setErr('')
    const amt = parseFloat(approved)
    if (needsAmount && !(amt > 0)) { setErr('An approved amount is required.'); return }
    setBusy(true)
    try {
      await recordBrokerResponse(row.id, response, needsAmount ? amt : null, respNote.trim() || null)
      toast?.success("Broker's answer recorded")
      setReplying(false)
      await onChanged?.()
      onClose?.()
    } catch (e) {
      setErr(e?.message || "Couldn't record the answer.") // RPC reason, verbatim
    } finally { setBusy(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-lg max-h-[92vh] flex flex-col rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">{typeLabel(row.accessorial_type)}</h3>
              <span className="text-base font-bold font-mono tabular-nums text-gray-900 dark:text-white">{money(row.claimed_amount)}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${meta.cls}`}>{meta.label}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-500 truncate mt-0.5">
              {row.driver_name || '—'}{row.load_number ? ` · ${row.load_number}` : ''}{row.broker_name ? ` · ${row.broker_name}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {err && <div className={S.errorBox}>{err}</div>}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Fact label="Delivered" value={fmtDate(row.event_date, true)} />
            <Fact label="Filed" value={filing ? filing.label : '—'} cls={filing?.cls} />
            <Fact label="Dispatcher" value={row.dispatcher_name} />
            <Fact label="Carrier" value={row.carrier_name} />
            <Fact label="Raised by" value={row.requested_by_name} />
            <Fact label="Outstanding" value={awaiting?.label} cls={awaiting?.cls} />
          </div>

          {basis && (
            <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1">Basis</p>
              <p className="text-sm text-gray-700 dark:text-slate-300">{basis}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Amount label="Claimed" value={row.claimed_amount} />
            <Amount label="Approved" value={row.approved_amount} tone="blue" />
            <Amount label="Collected" value={row.collected_amount} tone="green" />
          </div>

          {row.broker_response && (
            <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 p-3">
              <p className="text-xs text-gray-700 dark:text-slate-300">
                Broker <span className="font-semibold">{row.broker_response}</span>
                {row.response_by ? <span className="text-gray-500 dark:text-slate-400"> · recorded by {row.response_by}</span> : null}
              </p>
              {row.broker_response_note && <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">{row.broker_response_note}</p>}
            </div>
          )}
          {collected && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              Collected{row.collected_by ? ` · confirmed by ${row.collected_by}` : ''}. This request is closed.
            </p>
          )}

          {/* Documents — the proof, opened through signed URLs */}
          <div>
            <button type="button" onClick={() => setShowDocs(o => !o)}
              className="text-xs font-semibold text-gray-700 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white">
              📎 {row.doc_count ?? 0} document{(row.doc_count ?? 0) === 1 ? '' : 's'} <span aria-hidden>{showDocs ? '▾' : '▸'}</span>
            </button>
            {showDocs && (
              <div className="mt-2 space-y-1.5">
                {docs == null ? (
                  <div className="h-6 rounded bg-gray-100 dark:bg-white/5 animate-pulse" />
                ) : docs.length === 0 ? (
                  <p className="text-[11px] text-gray-400 dark:text-slate-500 italic">Nothing attached to this request.</p>
                ) : docs.map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-[11px]">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300 shrink-0">{docTypeLabel(d.doc_type)}</span>
                    <button type="button" onClick={() => openDoc(d.file_path)} className="text-orange-600 dark:text-orange-400 hover:underline truncate">{d.file_name || d.file_path}</button>
                    <span className="ml-auto text-gray-400 dark:text-slate-500 shrink-0">{fmtChicagoTs(d.uploaded_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Record the broker's answer — same RPC the board uses */}
          {!collected && replying && (
            <div className="border-t border-gray-100 dark:border-white/5 pt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {RESPONSES.map(r => (
                  <button key={r.value} type="button" onClick={() => { setResponse(r.value); setErr('') }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                      response === r.value
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}>{r.label}</button>
                ))}
                <span className="text-[11px] text-gray-400 dark:text-slate-500">{RESPONSES.find(r => r.value === response)?.hint}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {needsAmount && (
                  <input type="text" inputMode="decimal" className={`${S.input} !py-1 !w-32 text-xs font-mono tabular-nums`}
                    value={approved}
                    onChange={e => setApproved(String(e.target.value).replace(',', '.').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
                    placeholder="Amount" />
                )}
                <input className={`${S.input} !py-1 flex-1 min-w-[160px] text-xs`} value={respNote}
                  onChange={e => setRespNote(e.target.value)} placeholder="What they said (optional)" />
                <button type="button" onClick={submitResponse} disabled={busy}
                  className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-lg transition-colors">
                  {busy ? 'Saving…' : 'Record it'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-100 dark:border-white/5 p-4 flex flex-wrap items-center justify-end gap-2">
          {!collected && !replying && (
            <button onClick={() => setReplying(true)} className={S.btnCancel}>Record broker response</button>
          )}
          {!collected && (
            <button onClick={() => setCollecting(true)}
              className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-colors">
              Confirm collected
            </button>
          )}
          {collected && <button onClick={onClose} className={S.btnCancel}>Close</button>}
        </div>
      </div>

      {collecting && (
        <ConfirmCollectedModal
          target={{ label: `${row.driver_name || '—'} · ${row.load_number || '—'}`, amount: row.approved_amount ?? row.claimed_amount }}
          onClose={() => setCollecting(false)}
          onSubmit={async (amount, on) => {
            await confirmCollected(row.id, amount, on)
            toast?.success('Collection confirmed')
            setCollecting(false)
            await onChanged?.()
            onClose?.()
          }}
        />
      )}
    </div>,
    document.body
  )
}

function Fact({ label, value, cls }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className={`text-sm truncate ${cls || 'text-gray-800 dark:text-slate-200'}`}>{value || '—'}</p>
    </div>
  )
}

const AMT_TONE = { plain: 'text-gray-900 dark:text-white', blue: 'text-blue-700 dark:text-blue-300', green: 'text-emerald-600 dark:text-emerald-400' }
function Amount({ label, value, tone = 'plain' }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className={`text-sm font-bold font-mono tabular-nums ${value == null ? 'text-gray-300 dark:text-slate-600' : AMT_TONE[tone]}`}>
        {value == null ? '—' : money(value)}
      </p>
    </div>
  )
}
