import { useCallback, useEffect, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { S } from '../../../lib/styles'
import { fetchBrokerProfile, fetchBrokerDocuments, fetchBrokerCreditHistory } from './customersApply'
import CreditEvent from '../../after-hours/shift-board/BrokerCredit'
import { fmtEventDate, isNoCredit, daysSince } from '../../after-hours/shift-board/brokerCreditData'

// Broker profile — read-only view of everything BUDDY knows about a customer:
// contact, risk (impersonation, not accusation), the two volume figures kept
// separate, the accessorial terms OBSERVED across its loads, and where paperwork
// actually goes. Setting idle reasons / editing terms lives elsewhere.

// The four list filters, so the back control can name the view it returns to.
const FILTER_LABEL = { loads: 'With loads', all: 'All customers', hold: 'Credit hold', risk: 'On a risk list' }

export default function CustomerProfile() {
  const { id } = useParams()
  // The list carries its view here on the URL, so back returns to the filter and
  // search you left — and still does after a refresh, when history is gone.
  const [params] = useSearchParams()
  const [profile, setProfile] = useState(null)
  const [docs, setDocs] = useState([])
  const [credit, setCredit] = useState([])   // full history, lifted events included
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const [p, d] = await Promise.all([fetchBrokerProfile(id), fetchBrokerDocuments(id).catch(() => [])])
      setProfile(p); setDocs(d)
      // MC comes off the profile, so the history fetch has to wait on it. Credit
      // events match on MC only — the credit list and the customer record often
      // spell the company differently.
      setCredit(p?.mc_number ? await fetchBrokerCreditHistory(p.mc_number) : [])
    } catch { setError(true) }
    finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  if (error || !profile) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <p className="text-sm text-gray-500 dark:text-slate-400">This broker profile couldn&apos;t be loaded.</p>
        <Link to="/fleet/customers?filter=all" className="text-sm text-orange-600 dark:text-orange-400 hover:underline mt-2 inline-block">Back to Customers</Link>
      </div>
    )
  }

  const { name, tms_code, mc_number, credit_limit, contact, risk, buddy, tms_snapshot, observed_terms, billing, address } = profile
  const flagged = !!(risk && (risk.id_theft || risk.nonpayment || risk.double_brokering))
  // 1 broker in 1,000 is on hold — rare enough that it belongs beside the name,
  // not buried in the Billing block.
  const onHold = billing?.credit_hold === true
  const synced = !!tms_snapshot?.synced_at
  // No sync → no comparison at all (comparing against nothing reads the whole
  // BUDDY figure as a discrepancy on every profile).
  const gap = synced ? volumeGap(buddy, tms_snapshot) : null

  // Arriving straight from a URL there is no view to return to, so back offers
  // the whole directory rather than the narrower default.
  const qs = params.toString()
  const backTo = qs ? `/fleet/customers?${qs}` : '/fleet/customers?filter=all'
  const backLabel = qs
    ? (FILTER_LABEL[params.get('filter') || 'loads'] || 'Customers') + (params.get('q') ? ` · “${params.get('q')}”` : '')
    : 'All customers'

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header — full width above the columns */}
      <div>
        <Link to={backTo}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 transition-colors mb-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          {backLabel}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{name || 'Broker'}</h1>
          {onHold && (
            <span title="This broker is on credit hold in the TMS"
              className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/40">
              Credit hold
            </span>
          )}
          {flagged && <RiskChips risk={risk} />}
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
          {[tms_code ? `TMS ${tms_code}` : null, mc_number ? `MC ${mc_number}` : null,
            [contact?.city, contact?.state].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ') || 'No TMS details on record'}
        </p>
      </div>

      {/* Two columns from lg: who they are and what they owe on the left, how
          they actually trade on the right. items-start so a clean broker's short
          left column doesn't stretch to match the right. Single column below lg,
          in the original order. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* ── Identity and money ── */}
        <div className="space-y-4 min-w-0">
          {/* Credit sits above the standing flags — it's the live one. */}
          <CreditHistory events={credit} />
          {flagged && <RiskBlock risk={risk} />}

          <Card>
            <Eyebrow>Contact</Eyebrow>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-2 text-sm">
              <Row label="Phone" v={contact?.phone} mono />
              <Row label="Email" v={contact?.email} />
              <Row label="Location" v={[contact?.city, contact?.state, contact?.country].filter(Boolean).join(', ')} />
            </dl>
          </Card>

          <Billing billing={billing} creditLimit={credit_limit} />
          <Address address={address} contact={contact} />
        </div>

        {/* ── The operational picture ── */}
        <div className="space-y-4 min-w-0">
          {/* Two volume figures — never blended. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <Card>
              <Eyebrow>BUDDY</Eyebrow>
              <p className="text-[11px] text-gray-400 dark:text-slate-500">Counted from BUDDY&apos;s own loads table.</p>
              <dl className="mt-2 text-sm space-y-1.5">
                <Row label="Loads (all time)" v={num(buddy?.loads_total)} mono />
                <Row label="Loads this year" v={num(buddy?.loads_ytd)} mono />
                <Row label="Last load" v={fmtDate(buddy?.last_load)} />
              </dl>
            </Card>
            <Card>
              <Eyebrow>TMS at last sync{synced ? ` · ${fmtDate(tms_snapshot.synced_at)}` : ''}</Eyebrow>
              {synced ? (
                <>
                  <p className="text-[11px] text-gray-400 dark:text-slate-500">A snapshot from the export — BUDDY&apos;s loads have moved on since.</p>
                  <dl className="mt-2 text-sm space-y-1.5">
                    <Row label="Loads this year" v={num(tms_snapshot?.loads_ytd)} mono />
                    <Row label="Sales this year" v={tms_snapshot?.sales_ytd != null ? money(tms_snapshot.sales_ytd) : null} mono />
                    <Row label="Last load" v={fmtDate(tms_snapshot?.last_load)} />
                    <Row label="Status" v={tms_snapshot?.status} />
                  </dl>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-400 dark:text-slate-500 italic">Not yet synced — run a Customers import.</p>
              )}
            </Card>
          </div>
          {/* Only after a sync, and only when the gap is beyond snapshot drift (~5%) —
              the export is a moment in time and BUDDY's loads keep moving, so a few
              loads' difference is expected, not a fault. */}
          {gap?.significant && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 -mt-1">
              BUDDY and the TMS snapshot differ by {gap.count.toLocaleString()} loads this year — a gap this large may mean the loads importer missed some rows.
            </p>
          )}

          {/* Accessorial terms observed */}
          <Card>
            <Eyebrow>Accessorial terms observed</Eyebrow>
            {observed_terms && observed_terms.loads_with_terms > 0 ? (
              <div className="mt-2 space-y-1 text-sm text-gray-700 dark:text-slate-300">
                {observed_terms.free_hours?.length > 0 && (
                  <p>Detention free hours seen: <span className="font-mono">{observed_terms.free_hours.join(', ')}</span></p>
                )}
                <p>
                  {observed_terms.rates?.length > 0 && <>Rates seen: <span className="font-mono">{observed_terms.rates.map(r => money(r)).join(', ')}</span></>}
                  {observed_terms.penalty_max != null && <> · Highest penalty: <span className="font-mono">{money(observed_terms.penalty_max)}</span></>}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-slate-500">
                  From {observed_terms.loads_with_terms.toLocaleString()} load{observed_terms.loads_with_terms === 1 ? '' : 's'} with stated terms. Terms are negotiated per load, not set per broker — this is the observed range, not a rule to apply.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-400 dark:text-slate-500 italic">No stated accessorial terms observed on this broker&apos;s loads yet.</p>
            )}
          </Card>

          {/* Paperwork destinations */}
          <Card>
            <Eyebrow>Paperwork destinations</Eyebrow>
            <PodEmails observed={observed_terms} />
          </Card>

          {/* Documents */}
          <Card>
            <Eyebrow>Documents</Eyebrow>
            {docs.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400 dark:text-slate-500 italic">No documents attached. Rate confirmations can be attached here.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {docs.map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-[11px]">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300 shrink-0">{d.doc_type || 'doc'}</span>
                    <span className="text-gray-700 dark:text-slate-300 truncate">{d.file_name || d.file_path}</span>
                    <span className="ml-auto text-gray-400 dark:text-slate-500 shrink-0">{fmtDate(d.uploaded_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ── Apex credit ───────────────────────────────────────────────────────────────
// The open event in full, then everything that came before it. History matters
// here in a way it doesn't for the standing flags: a broker stopped twice in six
// months is a pattern, and broker_credit_status only ever returns the live one.
function CreditHistory({ events }) {
  const list = events || []
  if (list.length === 0) return null
  const open = list.filter(e => !e.resolved_on)
  const past = list.filter(e => e.resolved_on)

  return (
    <Card>
      <Eyebrow>Apex credit</Eyebrow>
      <div className="mt-2 space-y-2">
        {/* The open event reuses the board's block, so the wording an associate
            reads at 2am and the wording Accounting reads here are the same. */}
        {open.map(e => (
          <CreditEvent key={e.id}
            credit={{
              event_type: e.event_type,
              active_from: e.active_from,
              days_active: daysSince(e.active_from),
              is_stale: daysSince(e.active_from) > 90,
              new_limit_usd: e.new_limit_usd,
              exceeded_by_usd: e.exceeded_by_usd,
              reason: e.reason,
              source: e.source,
            }} />
        ))}

        {past.length > 0 && (
          <div className={open.length ? 'pt-2 border-t border-gray-100 dark:border-white/5' : ''}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">
              Earlier {past.length === 1 ? 'event' : 'events'}
            </p>
            <div className="space-y-1.5">
              {past.map(e => (
                <div key={e.id} className="text-[11px] leading-snug">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium text-gray-700 dark:text-slate-300">
                      {isNoCredit(e) ? 'No credit' : 'Credit limit reduced'}
                    </span>
                    <span className="text-gray-500 dark:text-slate-400">
                      {fmtEventDate(e.active_from, true)} → lifted {fmtEventDate(e.resolved_on, true)}
                    </span>
                    <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0">Resolved</span>
                  </div>
                  {e.reason && <p className="text-gray-500 dark:text-slate-400 italic">“{e.reason}”</p>}
                  {e.source && <p className="text-[10px] text-gray-400 dark:text-slate-500">{e.source}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Billing ───────────────────────────────────────────────────────────────────
// Everything the TMS knows about paying and being paid. The AP address is the
// INVOICE desk and is labelled as such: at four of the eleven top brokers it is a
// different mailbox from the one POD and BOL go to, and sending paperwork to
// apinvoices@ sends it to the wrong desk.
function Billing({ billing, creditLimit }) {
  const b = billing || {}
  // credit_limit lives at the top level of the RPC as well; prefer the billing
  // block and fall back, so this reads right either way.
  const limit = b.credit_limit ?? creditLimit
  const balance = b.open_balance
  const hasBalance = balance != null && Number(balance) !== 0
  const nothing = [limit, b.payment_terms, b.billing_preference, b.ap_emails, b.ap_phone, b.setup_date].every(v => v == null)
    && b.credit_hold == null && !hasBalance

  return (
    <Card>
      <Eyebrow>Billing</Eyebrow>
      {nothing ? (
        <p className="mt-2 text-sm text-gray-400 dark:text-slate-500 italic">No billing details yet — run a Customers import.</p>
      ) : (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-2 text-sm">
            <Row label="Payment terms" v={b.payment_terms} />
            <Row label="Billing preference" v={b.billing_preference} />
            {/* A zero limit is a real, deliberate value — not the same as "no
                limit on record", so it renders as $0 rather than a dash. */}
            <Row label="Credit limit" v={limit != null ? money(limit) : null} mono />
            <Row label="Credit hold" v={b.credit_hold == null ? null : (b.credit_hold ? 'Yes' : 'No')}
              tone={b.credit_hold ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''} />
            {/* Only 14 brokers carry a balance; a zero is noise on the other 986. */}
            {hasBalance && <Row label="Open balance" v={money(balance)} mono tone="text-amber-600 dark:text-amber-400 font-semibold" />}
            <Row label="Setup date" v={fmtDate(b.setup_date)} />
            <Row label="AP phone" v={b.ap_phone} mono />
          </dl>

          {b.ap_emails && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Invoices to</p>
              <p className="mt-1 text-sm font-mono text-gray-700 dark:text-slate-200 break-all">{b.ap_emails}</p>
              <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
                Where the invoice goes. POD and BOL destinations come from the rate confirmation and
                are listed under Paperwork destinations — at several brokers they are a different desk.
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

// ── Address ───────────────────────────────────────────────────────────────────
function Address({ address, contact }) {
  const a = address || {}
  const nothing = [a.full, a.street1, a.street2, a.zip].every(v => v == null)
    && [contact?.city, contact?.state, contact?.country].every(v => v == null)
  if (nothing) return null

  return (
    <Card>
      <Eyebrow>Address</Eyebrow>
      {a.full && <p className="mt-2 text-sm text-gray-700 dark:text-slate-200">{a.full}</p>}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-2 text-sm">
        <Row label="Street" v={a.street1} />
        {a.street2 && <Row label="Street 2" v={a.street2} />}
        <Row label="City" v={contact?.city} />
        <Row label="State" v={contact?.state} />
        {/* Text, never a number — leading zeros are part of the zip. */}
        <Row label="Zip" v={a.zip} mono />
        <Row label="Country" v={contact?.country} />
      </dl>
    </Card>
  )
}

// ── Risk — impersonation, never accusation. Same wording as the shift board. ──
function RiskChips({ risk }) {
  const chips = [
    risk.id_theft && ['Identity theft', 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40'],
    risk.nonpayment && ['Nonpayment', 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40'],
    risk.double_brokering && ['Double brokering', 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/40'],
  ].filter(Boolean)
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map(([label, cls]) => (
        <span key={label} className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
      ))}
    </div>
  )
}
function RiskBlock({ risk }) {
  const footer = [risk.source, risk.list_date ? `listed ${fmtDate(risk.list_date)}` : null].filter(Boolean).join(' · ')
  return (
    <div className="rounded-xl border border-violet-300 dark:border-violet-500/40 bg-white dark:bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4 shrink-0 text-violet-600 dark:text-violet-400 fill-current"><path d="M10 1l7 3v5c0 4.4-3 8.3-7 9.4C6 17.3 3 13.4 3 9V4l7-3z" /></svg>
        <h2 className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wide">Broker risk</h2>
      </div>
      <div className="space-y-2">
        {risk.id_theft && (
          <div className="rounded-lg border border-violet-200 dark:border-violet-500/25 bg-violet-50 dark:bg-violet-500/10 p-2.5 text-[11px] leading-snug">
            <p className="font-semibold text-violet-800 dark:text-violet-300">Identity theft reported</p>
            <p className="mt-0.5 text-gray-600 dark:text-slate-300">Someone has impersonated this broker. The company itself is legitimate — verify you are dealing with the real one.</p>
            <ul className="mt-1 space-y-0.5 text-gray-600 dark:text-slate-300">
              <li>· Confirm the rep works there</li>
              <li>· Confirm the load # is in their system</li>
              <li>· Do not accept a changed remit-to</li>
            </ul>
          </div>
        )}
        {risk.nonpayment && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 p-2.5 text-[11px] leading-snug">
            <p className="font-semibold text-amber-800 dark:text-amber-300">Nonpayment history</p>
            <p className="mt-0.5 text-gray-600 dark:text-slate-300">Reported for slow or non-payment. Get the POD in on time — late paperwork is the first thing disputed.</p>
          </div>
        )}
        {risk.double_brokering && (
          <div className="rounded-lg border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 p-2.5 text-[11px] leading-snug">
            <p className="font-semibold text-rose-800 dark:text-rose-300">Double brokering reported</p>
            <p className="mt-0.5 text-gray-600 dark:text-slate-300">Confirm this broker actually holds the load before dispatching.</p>
          </div>
        )}
      </div>
      {footer && <p className="mt-3 pt-2 border-t border-gray-100 dark:border-white/5 text-[10px] text-gray-400 dark:text-slate-500">{footer}</p>}
    </div>
  )
}

// Top six POD addresses by load count, then the variant total behind a
// disclosure — the point is to make the dominant address obvious, not to dump 56.
function PodEmails({ observed }) {
  const [open, setOpen] = useState(false)
  const emails = observed?.pod_emails || []
  const variants = observed?.pod_email_variants || 0
  if (emails.length === 0 && variants === 0) {
    return <p className="mt-2 text-sm text-gray-400 dark:text-slate-500 italic">No POD destinations observed yet.</p>
  }
  const shown = open ? emails : emails.slice(0, 6)
  const hiddenEmails = emails.length - shown.length
  // Ranked entries beyond the top six plus the long tail of one-off variants.
  const more = hiddenEmails + variants
  const label = `and ${more.toLocaleString()} more address${more === 1 ? '' : 'es'} seen`
  return (
    <div className="mt-2 space-y-1">
      {shown.map((e, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-mono text-gray-700 dark:text-slate-300 truncate">{e.email}</span>
          <span className="text-[11px] text-gray-400 dark:text-slate-500 shrink-0 tabular-nums">{num(e.loads)} loads</span>
        </div>
      ))}
      {more > 0 && (hiddenEmails > 0 ? (
        <button type="button" onClick={() => setOpen(true)} className="text-[11px] italic text-gray-500 dark:text-slate-400 hover:underline">{label} ▾</button>
      ) : (
        <p className="text-[11px] italic text-gray-400 dark:text-slate-500">{label}</p>
      ))}
    </div>
  )
}

// ── small presentational helpers ──
function Card({ children }) { return <div className={`${S.card} p-4`}>{children}</div> }
function Eyebrow({ children }) { return <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{children}</p> }
function Row({ label, v, mono, tone }) {
  // `v || '—'` would turn a legitimate $0 or "0" into a dash, so only null and
  // empty fall back.
  const shown = v == null || v === '' ? '—' : v
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-400 dark:text-slate-500 shrink-0">{label}</dt>
      <dd className={`text-right ${tone || 'text-gray-700 dark:text-slate-200'} ${mono ? 'font-mono tabular-nums' : ''}`}>{shown}</dd>
    </div>
  )
}
function num(n) { return n == null ? '—' : Number(n).toLocaleString('en-US') }
function money(n) { return n == null ? '—' : `$${Number(n).toLocaleString('en-US')}` }
function fmtDate(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return v ? String(v) : '—'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
// Gap between BUDDY's and the TMS snapshot's YTD load counts. "significant" only
// past ~5% of the TMS figure — below that it's normal snapshot drift, not a
// missed-rows signal.
function volumeGap(buddy, tms) {
  const b = Number(buddy?.loads_ytd), t = Number(tms?.loads_ytd)
  if (!Number.isFinite(b) || !Number.isFinite(t)) return null
  const count = Math.abs(b - t)
  if (count === 0) return null
  const pct = t > 0 ? count / t : 1
  return { count, significant: pct > 0.05 }
}
