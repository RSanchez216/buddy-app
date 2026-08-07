import { useCallback, useEffect, useMemo, useState } from 'react'
import { S } from '../../../lib/styles'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import {
  FLAG_CATEGORIES, categoryLabel, fetchBrokerFlags, fetchFlagReasons, createFlagReason,
  createBrokerFlag, resolveBrokerFlag, fetchBrokerCreditEvents, createCreditStop,
  liftCreditStop, daysRunning,
} from './brokerFlagsData'

// Broker flags — what Accounting knows about this broker, recorded here rather
// than posted to Telegram and lost.
//
// Active first, history underneath. Resolving NEVER deletes: a broker stopped
// twice in six months is exactly the thing someone needs to see, and that is
// only visible if the first stop is still on the record.
//
// ATTRIBUTION IS ALWAYS "Accounting". created_by is stored — you can find out
// who typed it — but never rendered. A flag is a company position, not one
// employee's opinion about a company MANAS hauls for daily.
//
// Credit stops live in broker_credit_events, not broker_flags, and are merged
// into the same list here. The reader sees one list; only the writer sees two
// forms, because a credit stop has a factor and limits that no other flag has.

const TONE = {
  identity: {
    box: 'bg-[#F5F3FF] border-[#DDD6FE] dark:bg-[rgba(124,58,237,.17)] dark:border-[rgba(167,139,250,.42)]',
    title: 'text-[#6D28D9] dark:text-[#C4B5FD]',
  },
  payment: {
    box: 'bg-[#FFFBEB] border-[#FDE68A] dark:bg-[rgba(180,83,9,.20)] dark:border-[rgba(251,191,36,.40)]',
    title: 'text-[#B45309] dark:text-[#FCD34D]',
  },
  credit: {
    box: 'bg-[#FEF2F2] border-[#FECACA] dark:bg-[rgba(220,38,38,.17)] dark:border-[rgba(248,113,113,.40)]',
    title: 'text-[#DC2626] dark:text-[#FCA5A5]',
  },
  billing: {
    box: 'bg-[#F8FAFC] border-[#E2E8F0] dark:bg-[rgba(148,163,184,.10)] dark:border-[rgba(148,163,184,.28)]',
    title: 'text-[#0F172A] dark:text-[#F1F5F9]',
  },
  other: {
    box: 'bg-[#F8FAFC] border-[#E2E8F0] dark:bg-[rgba(148,163,184,.10)] dark:border-[rgba(148,163,184,.28)]',
    title: 'text-[#64748B] dark:text-[#94A3B8]',
  },
}
const EYEBROW = 'text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500'
const BODY = 'text-gray-600 dark:text-slate-300'
const META = 'text-gray-400 dark:text-slate-500'

const fmtDate = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const usd = (n) => (n == null ? null : `$${Number(n).toLocaleString('en-US')}`)
const todayChicago = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

export default function BrokerFlagsPanel({ mcNumber, brokerName }) {
  const { profile } = useAuth()
  const toast = useToast()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [flags, setFlags] = useState([])
  const [credit, setCredit] = useState([])
  const [reasons, setReasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(null) // 'flag' | 'credit' | null

  const load = useCallback(async () => {
    if (!mcNumber) { setFlags([]); setCredit([]); setLoading(false); return }
    setLoading(true)
    try {
      const [f, c, r] = await Promise.all([
        fetchBrokerFlags(mcNumber),
        fetchBrokerCreditEvents(mcNumber),
        fetchFlagReasons().catch(() => []),
      ])
      setFlags(f); setCredit(c); setReasons(r)
    } catch (e) {
      toast.error("Couldn't load broker flags", e)
    } finally { setLoading(false) }
  }, [mcNumber, toast])

  useEffect(() => { load() }, [mcNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  // One merged list, credit stops first — a stop is the only entry that can
  // prevent the load being funded at all.
  const { active, history } = useMemo(() => {
    const items = [
      ...credit.map(c => ({ kind: 'credit', id: c.id, category: 'credit', active_from: c.active_from, resolved_on: c.resolved_on, raw: c })),
      ...flags.map(f => ({ kind: 'flag', id: f.id, category: f.category, active_from: f.active_from, resolved_on: f.resolved_on, raw: f })),
    ]
    const byDate = (a, b) => String(b.active_from || '').localeCompare(String(a.active_from || ''))
    return {
      active: items.filter(i => !i.resolved_on).sort((a, b) => (a.kind === b.kind ? byDate(a, b) : a.kind === 'credit' ? -1 : 1)),
      history: items.filter(i => i.resolved_on).sort(byDate),
    }
  }, [flags, credit])

  if (!mcNumber) {
    return (
      <Card>
        <Header canEdit={false} />
        <p className="text-xs text-gray-400 dark:text-slate-500 italic mt-2">
          No MC number on this customer, so flags can&apos;t be matched to it. Add the MC first.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <Header canEdit={canEdit} onAddFlag={() => setAdding('flag')} onAddCredit={() => setAdding('credit')} />

      {loading ? (
        <div className="mt-3 h-20 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />
      ) : (
        <>
          {adding === 'flag' && (
            <AddFlagForm mcNumber={mcNumber} reasons={reasons}
              onReasonAdded={(r) => setReasons(rs => [...rs, r])}
              onDone={async () => { setAdding(null); await load() }}
              onCancel={() => setAdding(null)} />
          )}
          {adding === 'credit' && (
            <AddCreditForm mcNumber={mcNumber}
              onDone={async () => { setAdding(null); await load() }}
              onCancel={() => setAdding(null)} />
          )}

          <div className="mt-3 space-y-1.5">
            {active.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500 italic">
                No active flags on {brokerName || 'this broker'}.
              </p>
            ) : active.map(i => (
              <FlagRow key={`${i.kind}-${i.id}`} item={i} canEdit={canEdit} onChanged={load} />
            ))}
          </div>

          {history.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5">
              <p className={`${EYEBROW} mb-1.5`}>
                Earlier — {history.length} resolved
              </p>
              <div className="space-y-1.5">
                {history.map(i => <FlagRow key={`${i.kind}-${i.id}`} item={i} history />)}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function Card({ children }) {
  return (
    <div className={`${S.card} p-4`}>{children}</div>
  )
}

function Header({ canEdit, onAddFlag, onAddCredit }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white">Broker flags</h3>
      {canEdit && (
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={onAddFlag} className={S.btnSecondary}>Add a flag</button>
          <button onClick={onAddCredit} className={S.btnSecondary}>Add a credit stop</button>
        </div>
      )}
    </div>
  )
}

// One entry. A credit stop reads differently from the other three: it ends when
// the factor lifts it, so its action says "Lift this stop" and it shows how long
// it has been running.
function FlagRow({ item, canEdit, history, onChanged }) {
  const toast = useToast()
  const { profile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const isCredit = item.kind === 'credit'
  const t = TONE[item.category] || TONE.other
  const r = item.raw

  const title = isCredit
    ? `${r.factor || 'Factor'} pulled credit${usd(r.new_limit_usd) ? ` to ${usd(r.new_limit_usd)}` : ''}`
    : r.headline
  const body = isCredit
    ? [usd(r.prior_limit_usd) ? `Down from ${usd(r.prior_limit_usd)}.` : null, r.reason].filter(Boolean).join(' ')
    : r.body

  const days = isCredit && !item.resolved_on ? daysRunning(item.active_from) : null

  const act = async () => {
    setBusy(true)
    try {
      if (isCredit) await liftCreditStop(item.id)
      else await resolveBrokerFlag(item.id, { userId: profile?.id })
      toast.success(isCredit ? 'Credit stop lifted' : 'Flag resolved')
      await onChanged?.()
    } catch (e) {
      toast.error(isCredit ? "Couldn't lift the stop" : "Couldn't resolve the flag", e)
    } finally { setBusy(false); setConfirming(false) }
  }

  return (
    <div className={`rounded-lg border p-2.5 ${history ? 'bg-gray-50 dark:bg-white/[0.02] border-gray-200 dark:border-white/10' : t.box}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className={`text-[12px] font-semibold leading-snug ${history ? 'text-gray-600 dark:text-slate-300' : t.title}`}>
            {title}
          </p>
          {body && <p className={`mt-0.5 text-[11px] leading-snug ${BODY}`}>{body}</p>}
          {!history && !isCredit && r.checklist?.length > 0 && (
            <ul className={`mt-1 space-y-0.5 text-[11px] leading-snug ${BODY}`}>
              {r.checklist.map(c => <li key={c}>· {c}</li>)}
            </ul>
          )}
          {!history && (r.verify_phone || r.verify_email) && (
            <p className={`mt-1 text-[11px] ${BODY}`}>
              Verify on {[r.verify_phone, r.verify_email].filter(Boolean).join(' · ')}
            </p>
          )}
          {r.note && <p className={`mt-1 text-[11px] italic ${META}`}>{r.note}</p>}
          <p className={`mt-1 text-[10px] ${META}`}>
            {/* Source, never a person. */}
            {r.source || 'Accounting'} · {fmtDate(item.active_from)}
            {days != null && ` · running ${days} day${days === 1 ? '' : 's'}`}
            {item.resolved_on && ` → ${isCredit ? 'lifted' : 'resolved'} ${fmtDate(item.resolved_on)}`}
          </p>
          {item.resolved_on && r.resolved_note && (
            <p className={`mt-0.5 text-[10px] italic ${META}`}>{r.resolved_note}</p>
          )}
        </div>

        <span className={`shrink-0 font-mono text-[8px] uppercase tracking-wider leading-4 ${META}`}>
          {isCredit ? 'CREDIT' : categoryLabel(item.category)}
        </span>
      </div>

      {!history && canEdit && (
        <div className="mt-2 flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-[11px] text-gray-500 dark:text-slate-400">
                {isCredit ? 'Lift this stop?' : 'Resolve this flag?'}
              </span>
              <button onClick={act} disabled={busy}
                className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50">
                {busy ? 'Saving…' : 'Yes'}
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy}
                className="text-[11px] text-gray-500 dark:text-slate-400 hover:underline">No</button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)}
              className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">
              {isCredit ? 'Lift this stop' : 'Resolve'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Category first: it decides the colour, the wording available, and whether the
// flag can end by itself.
function AddFlagForm({ mcNumber, reasons, onReasonAdded, onDone, onCancel }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [category, setCategory] = useState('')
  const [reasonId, setReasonId] = useState('')
  const [headline, setHeadline] = useState('')
  const [body, setBody] = useState('')
  const [checklist, setChecklist] = useState(null)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState('Accounting')
  const [activeFrom, setActiveFrom] = useState(todayChicago())
  const [note, setNote] = useState('')
  const [newReason, setNewReason] = useState(false)
  const [busy, setBusy] = useState(false)

  const forCategory = reasons.filter(r => r.category === category)

  const pickReason = (id) => {
    setReasonId(id)
    const r = reasons.find(x => x.id === id)
    // Prefill and stay editable — the picked wording is a starting point for
    // this broker, not a lock.
    setHeadline(r?.headline || '')
    setBody(r?.body || '')
    setChecklist(r?.checklist || null)
  }

  const addReason = async () => {
    if (!category) { toast.error('Pick a category first.'); return }
    if (!headline.trim()) { toast.error('Give the reason a headline.'); return }
    setBusy(true)
    try {
      const r = await createFlagReason({ category, headline, body, userId: profile?.id })
      onReasonAdded(r)
      setReasonId(r.id); setNewReason(false)
      toast.success('Reason added — everyone can pick it now')
    } catch (e) { toast.error("Couldn't add the reason", e) }
    finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true)
    try {
      await createBrokerFlag({
        mcNumber, category, reasonId: reasonId || null, headline, body, checklist,
        verifyPhone: phone, verifyEmail: email, source, note, activeFrom, userId: profile?.id,
      })
      toast.success('Flag added')
      await onDone()
    } catch (e) { toast.error("Couldn't add the flag", e) }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2.5">
      <div>
        <label className={S.label}>Category</label>
        <div className="flex flex-wrap gap-1.5">
          {FLAG_CATEGORIES.map(c => (
            <button key={c.key} type="button" title={c.hint}
              onClick={() => { setCategory(c.key); setReasonId(''); setHeadline(''); setBody(''); setChecklist(null) }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                category === c.key
                  ? 'border-orange-400 bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300'
                  : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {category && (
        <>
          <div>
            <label className={S.label}>Reason</label>
            {!newReason ? (
              <div className="flex items-center gap-2">
                <select className={S.input} value={reasonId} onChange={e => pickReason(e.target.value)}>
                  <option value="">— pick a reason —</option>
                  {forCategory.map(r => (
                    <option key={r.id} value={r.id}>{r.headline}{r.is_custom ? ' (added)' : ''}</option>
                  ))}
                </select>
                <button type="button" onClick={() => { setNewReason(true); setReasonId(''); setHeadline(''); setBody('') }}
                  className="shrink-0 text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline whitespace-nowrap">
                  Add a new reason
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <input className={S.input} value={headline} onChange={e => setHeadline(e.target.value)}
                  placeholder="Headline — what is wrong, in one line" />
                <textarea rows={2} className={`${S.input} min-h-[56px] resize-y`} value={body}
                  onChange={e => setBody(e.target.value)} placeholder="What should someone do about it? (optional)" />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={addReason} disabled={busy} className={S.btnSecondary}>
                    Save reason for everyone
                  </button>
                  <button type="button" onClick={() => setNewReason(false)} className="text-[11px] text-gray-500 hover:underline">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {reasonId && !newReason && (
            <>
              <div>
                <label className={S.label}>Wording on this flag</label>
                <input className={S.input} value={headline} onChange={e => setHeadline(e.target.value)} />
                <textarea rows={2} className={`${S.input} min-h-[56px] resize-y mt-1.5`} value={body}
                  onChange={e => setBody(e.target.value)} placeholder="Body (optional)" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={S.label}>Verify phone <span className="font-normal normal-case text-gray-400">(optional)</span></label>
                  <input className={S.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="800-555-0100" />
                </div>
                <div>
                  <label className={S.label}>Verify email <span className="font-normal normal-case text-gray-400">(optional)</span></label>
                  <input className={S.input} value={email} onChange={e => setEmail(e.target.value)} placeholder="ap@broker.com" />
                </div>
                <div>
                  <label className={S.label}>Source</label>
                  <input className={S.input} value={source} onChange={e => setSource(e.target.value)} />
                </div>
                <div>
                  <label className={S.label}>Effective from</label>
                  <input type="date" className={S.input} value={activeFrom} onChange={e => setActiveFrom(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={S.label}>Note <span className="font-normal normal-case text-gray-400">(optional)</span></label>
                <textarea rows={2} className={`${S.input} min-h-[56px] resize-y`} value={note}
                  onChange={e => setNote(e.target.value)} placeholder="Anything specific to this broker" />
              </div>
            </>
          )}
        </>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className={S.btnCancel}>Cancel</button>
        <button onClick={save} disabled={busy || !category || !headline.trim() || newReason}
          className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 text-white rounded-lg transition-all">
          {busy ? 'Saving…' : 'Add flag'}
        </button>
      </div>
    </div>
  )
}

// Its own form, writing to broker_credit_events — a credit stop carries a factor
// and two limits that none of the other categories have.
function AddCreditForm({ mcNumber, onDone, onCancel }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [factor, setFactor] = useState('Apex')
  const [activeFrom, setActiveFrom] = useState(todayChicago())
  const [newLimit, setNewLimit] = useState('0')
  const [priorLimit, setPriorLimit] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await createCreditStop({ mcNumber, factor, activeFrom, newLimit, priorLimit, reason, userId: profile?.id })
      toast.success('Credit stop recorded')
      await onDone()
    } catch (e) { toast.error("Couldn't record the credit stop", e) }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-lg border border-[#FECACA] dark:border-[rgba(248,113,113,.40)] bg-[#FEF2F2] dark:bg-[rgba(220,38,38,.12)] p-3 space-y-2.5">
      <p className="text-[11px] text-gray-600 dark:text-slate-300">
        A credit stop ends when the factor lifts it, not when we resolve it.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={S.label}>Factor</label>
          <select className={S.input} value={factor} onChange={e => setFactor(e.target.value)}>
            <option value="Apex">Apex</option>
            <option value="RTS">RTS</option>
          </select>
        </div>
        <div>
          <label className={S.label}>Effective from</label>
          <input type="date" className={S.input} value={activeFrom} onChange={e => setActiveFrom(e.target.value)} />
        </div>
        <div>
          <label className={S.label}>New limit</label>
          <input className={S.input} value={newLimit} onChange={e => setNewLimit(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className={S.label}>Prior limit <span className="font-normal normal-case text-gray-400">(optional)</span></label>
          <input className={S.input} value={priorLimit} onChange={e => setPriorLimit(e.target.value)} placeholder="25000" />
        </div>
      </div>
      <div>
        <label className={S.label}>Reason <span className="font-normal normal-case text-gray-400">(optional)</span></label>
        <input className={S.input} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="What the factor said" />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className={S.btnCancel}>Cancel</button>
        <button onClick={save} disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-lg transition-all">
          {busy ? 'Saving…' : 'Record credit stop'}
        </button>
      </div>
    </div>
  )
}
