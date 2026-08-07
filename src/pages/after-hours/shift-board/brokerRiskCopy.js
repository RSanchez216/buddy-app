// Copy and formatting for the broker risk panel.
//
// Split out of BrokerRiskPanel.jsx so that file exports components only (fast
// refresh needs that), and so the exact strings can be asserted in a test
// harness against the approved copy table rather than eyeballed in a mockup.
//
// Filename is brokerRiskCopy.js, deliberately not brokerRiskPanel.js — a name
// differing from BrokerRiskPanel.jsx only by case resolves to the same module on
// this filesystem, which silently emptied a module's exports here once already.

export const RTS_SITE = 'https://rtspro.com/'

export const usd = (n) => (n == null ? null : `$${Number(n).toLocaleString('en-US')}`)

// 'Jan 22, 2026' from a date-only value, built from the parts so it can't shift
// a day through UTC.
export function fmtDate(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// 'Mar 2026' — the advance fee's as-of month.
export function fmtMonth(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// ── Rating ──────────────────────────────────────────────────────────────────
// Returns { tone, title, body, meta, link } or null when the block doesn't
// render. Driven entirely by rts_tone, which already encodes the RTS gating
// ('hidden' = this carrier doesn't factor with RTS) — never re-derived from
// carrier ids.
//
// `neutral` is the demoted form of `good`: same grade, verdict dropped because a
// red block sits below it. The grade itself is never hidden — the dispatcher
// reads everything and decides. Only the words "good to book" are suppressed.
//
// Meta lines are omitted when the underlying field is null rather than printing
// a label with nothing after it.
export function ratingCopy(v) {
  if (!v || v.rts_tone === 'hidden') return null

  const captured = fmtDate(v.rts_captured_on)
  const capturedMeta = captured ? `Captured ${captured}` : null
  const changed = fmtDate(v.rts_changed_on)
  const changedMeta = [
    v.rts_previous_rating ? `Was ${v.rts_previous_rating}` : null,
    changed ? `changed ${changed}` : null,
  ].filter(Boolean).join(' · ') || null

  switch (v.rts_tone) {
    case 'good':
      return { tone: 'emerald', title: `Rating ${v.rts_rating} — good to book`, body: null, meta: capturedMeta }
    case 'neutral':
      return { tone: 'slate', title: `Rating ${v.rts_rating}`, body: null, meta: capturedMeta }
    case 'amber':
      return {
        tone: 'amber', title: `Rating ${v.rts_rating} — slow pay`,
        body: 'Call RTS to approve the rate before booking.', meta: changedMeta,
      }
    case 'red':
      return {
        tone: 'red', title: `Rating ${v.rts_rating} — do not book`,
        body: 'Escalate to Accounting before dispatching.', meta: changedMeta,
      }
    case 'unrated':
      return {
        tone: 'slate', title: 'No RTS rating on record',
        body: "We haven't captured a grade for this broker.", meta: null,
        // rtspro.com only. Never a URL carrying a state= parameter — those are
        // single-use Auth0 tokens that expire within minutes.
        link: { href: RTS_SITE, label: 'Review Credit on RTS Site' },
      }
    default:
      return null
  }
}

// ── Credit event ────────────────────────────────────────────────────────────
export const creditTitle = (v) => `Apex pulled credit to ${usd(v?.credit_new_limit) ?? '$0'}`

// Two different sentences, deliberately NOT one template with a swapped tail.
// Binding means Apex funds this carrier and will not fund this load. Advisory
// means the information is real but Apex isn't the funder here, so it changes
// nothing about tonight — and saying "do not book" there would be wrong.
export function creditBody(v, carrierName) {
  const when = fmtDate(v?.credit_active_from)
  const prior = usd(v?.credit_prior_limit) ?? '$0'
  const head = `${when ? `${when}, ` : ''}down from ${prior}.`
  return v?.credit_is_binding === true
    ? `${head} Do not book — Apex will not fund this load.`
    : `${head} Advisory here — Apex does not fund ${carrierName || 'this carrier'}.`
}

// ── Advance fee ─────────────────────────────────────────────────────────────
export function feeTitle(v) {
  const flat = usd(v?.fee_flat)
  const pct = v?.fee_pct == null ? null : `${Number(v.fee_pct)}%`
  switch (v?.fee_rule) {
    case 'flat': return flat ? `Advance fee: ${flat}` : 'Advance fee'
    case 'percent': return pct ? `Advance fee: ${pct}` : 'Advance fee'
    case 'greater_of': return flat && pct ? `Advance fee: ${flat} or ${pct}` : `Advance fee: ${flat || pct || ''}`.trim()
    case 'sum': return flat && pct ? `Advance fee: ${flat} + ${pct}` : `Advance fee: ${flat || pct || ''}`.trim()
    // fee_raw is the un-parsed source string — better than a bare title if a
    // rule shows up that this doesn't know about.
    default: return v?.fee_raw ? `Advance fee: ${v.fee_raw}` : 'Advance fee'
  }
}

export const feeBody = (v) =>
  `${v?.fee_rule === 'greater_of' ? 'Whichever is greater. ' : ''}Pay the lumper first, then claim reimbursement.`

export const feeMeta = (v) => {
  const m = fmtMonth(v?.fee_as_of)
  return m ? `As of ${m} — the amount may have moved` : null
}

// ── Risk list ───────────────────────────────────────────────────────────────
// Split by what the flag actually MEANS. One generic "this broker has been
// impersonated" was a false statement about every nonpayment-flagged company —
// 53 loads in the last 30 days — and it sent the associate to verify an identity
// when the real task was getting the POD in before the invoice got disputed.
//
// identity and nonpayment are independent: 32 MCs carry 'IN' and render both.
//
// "Impersonated", never "bad broker" or "blacklisted". These are companies MANAS
// hauls for daily; the instruction is to VERIFY, not to avoid.
export const IDENTITY_TITLE = 'Identity theft reported'
export const IDENTITY_BODY = 'Someone has impersonated this broker. The company itself is legitimate — verify you are dealing with the real one.'
export const IDENTITY_CHECKS = [
  'Confirm the rep works there',
  'Confirm the load # is in their system',
  'Do not accept a changed remit-to',
]

export const NONPAYMENT_TITLE = 'Nonpayment history'
export const NONPAYMENT_BODY = 'Reported for slow or non-payment. Get the POD in on time — late paperwork is the first thing disputed.'

// The one 'U' broker. Kept rather than dropped: a panel whose job is to say what
// is known should not go silent on a flag it doesn't recognise.
export const RISK_LIST_TITLE = 'On the risk list'
export const RISK_LIST_BODY = 'This broker is flagged, without a recorded reason. Confirm the contact against the rate confirmation before you dispatch.'

// Billing requirements — paperwork conditions this broker attaches to getting
// paid. Slate, not a warning colour: nothing is wrong with the broker, there is
// just a condition to meet.
export const BILLING_TITLE = 'Billing requirements'
export const BILLING_BODY = 'This broker has paperwork conditions. Check the requirement before you invoice.'

// '{broker} · MC {mc} · {which list}' — small italic grey under the flag blocks.
// Named lists rather than "Accounting" alone so the associate knows which record
// to go and read.
export function riskSourceLine(v, brokerName) {
  if (!v) return null
  const lists = []
  if (v.risk_identity === true) lists.push('identity list')
  if (v.risk_nonpayment === true) lists.push('payment list')
  if (v.risk_billing === true) lists.push('billing requirements')
  if (v.risk_unclassified === true) lists.push('risk list')
  if (!lists.length) return null
  return [brokerName, v.mc_number ? `MC ${v.mc_number}` : null, lists.join(' + ')]
    .filter(Boolean).join(' · ')
}

// Does this row render any of the three flag blocks?
export const hasFlagBlock = (v) =>
  v?.risk_identity === true || v?.risk_nonpayment === true ||
  v?.risk_billing === true || v?.risk_unclassified === true

// Always shown when at least one block rendered. Nothing above may read as a
// guarantee — recourse applies at every grade, an A included.
export const PANEL_FOOTER = "Factored with recourse — the balance comes back to us if the broker doesn't pay."

// ── Clipboard message ───────────────────────────────────────────────────────
// Plain text for Telegram: no markdown, no tables, no bold. Telegram renders
// pasted markdown as literal asterisks, so anything decorative arrives as
// punctuation the reader has to look past.
//
// Built entirely from data already on the board row and its v_load_broker_risk
// entry — the same data driving the glyphs. No per-row query.

// Money WITH cents here, unlike the panel. The panel's "$15" is a label; this is
// a figure being pasted into a conversation about money, where $15 and $15.00
// read differently.
const usd2 = (n) => (n == null ? null : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

// 'Aug 7' from a date-only value, from the parts so it can't shift through UTC.
function shortDay(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// 'Wasco, CA' from 'Wasco, CA, US (PST) 08-07-2026 14:00 14:00'. City and state
// only — everything from the country onward is cut.
//
// Some source rows carry a state with no city. Emitting ', CA' for those would
// look like a bug in the message, so whichever half exists is used alone.
export function stopShort(city, state) {
  const c = (city || '').trim(), s = (state || '').trim()
  if (c && s) return `${c}, ${s}`
  return c || s || ''
}

// The fee, formatted for the message rather than for a title.
function feeAmount(v) {
  const flat = usd2(v?.fee_flat)
  const pct = v?.fee_pct == null ? null : `${Number(v.fee_pct)}%`
  switch (v?.fee_rule) {
    case 'flat': return flat
    case 'percent': return pct
    case 'greater_of': return flat && pct ? `${flat} or ${pct}` : (flat || pct)
    case 'sum': return flat && pct ? `${flat} + ${pct}` : (flat || pct)
    default: return v?.fee_raw || null
  }
}

// Alert lines: what STOPS you, then what is DUE, then what it COSTS.
//
// Three of the six row glyphs come from the LOAD, not the broker — the two POD
// deadline markers and the money-at-risk `$`. They are read from the same broker
// meta object the gutter renders from (`deadline_severity`, `money_at_risk`,
// `penalty_max_usd`); nothing here recomputes a threshold or an amount, because
// a glyph and a line that disagree are worse than no line at all.
//
// 'good' and 'neutral' ratings produce NOTHING. A clear grade is not an alert,
// and padding the message with reassurance buries what someone is being asked
// to act on.
export function riskWarningLines(v, load) {
  const out = []

  if (v) {
    // 1–2. Credit stop first: it is the only line that can stop the load.
    if (v.has_credit_event === true) {
      const when = fmtDate(v.credit_active_from)
      const head = `! Apex pulled credit to ${usd(v.credit_new_limit) ?? '$0'}${when ? ` on ${when}` : ''}.`
      out.push(v.credit_is_binding === true
        ? `${head} Do not book — Apex will not fund this load.`
        : `${head} Advisory — Apex does not fund ${v.carrier_name || 'this carrier'}.`)
    }

    // 3–4. Rating.
    if (v.rts_action === 'call_factor') {
      out.push(`! RTS rating ${v.rts_rating} — slow pay. Call RTS to approve the rate before booking.`)
    } else if (v.rts_action === 'do_not_book') {
      out.push(`! RTS rating ${v.rts_rating} — do not book. Escalate to Accounting.`)
    }

    // 5. Identity. "Impersonated", company called legitimate — never "bad
    // broker". The verify number rides on this line because this is the line
    // that asks someone to make a call.
    if (v.risk_identity === true) {
      const phone = (v.risk_verify_phone || '').trim()
      out.push('! Identity theft reported. The company is legitimate — confirm the rep works there and that the load # is in their system. Do not accept a changed remit-to.'
        + (phone ? ` Verify on ${phone}.` : ''))
    }
    // 6–7.
    if (v.risk_nonpayment === true) {
      out.push('! Nonpayment history. Get the POD in on time — late paperwork is the first thing disputed.')
    }
    if (v.risk_billing === true) {
      out.push('$ Billing requirements on this broker. Check the paperwork condition before you invoice.')
    }
    if (v.risk_unclassified === true) {
      out.push('! On the risk list.')
    }
  }

  // 8–9. POD deadlines — LOAD alerts. Only 'urgent' and 'soon' draw a glyph;
  // 'relaxed' and 'unknown' draw nothing, so they say nothing here either.
  if (load?.deadline_severity === 'urgent') out.push('! POD due within 24h of delivery.')
  else if (load?.deadline_severity === 'soon') out.push('! POD due within 48h of delivery.')

  // 10. Money at risk — LOAD alert. The amount is whatever the glyph's tooltip
  // shows, including its fallback when no figure is stated on the rate con.
  if (load?.money_at_risk) {
    const amt = load.penalty_max_usd
    out.push(amt != null
      ? `$ Up to $${Number(amt).toLocaleString('en-US')} at risk on this load.`
      : '$ Penalty stated on this rate con.')
  }

  // 11. Advance fee.
  if (v?.has_advance_fee === true) {
    const amt = feeAmount(v)
    out.push(`$ Advance fee: ${amt ?? '—'}. Pay the lumper first, then claim reimbursement.`)
  }

  return out
}

// The whole message.
//
// DRIVER FIRST. This goes to the dispatcher who owns the load, and a dispatcher
// navigates by driver — the broker name is how the problem is described, not how
// the load is found.
//
// `row` is the board row, `risk` its v_load_broker_risk entry, `load` the broker
// meta that drives the row's gutter glyphs. Any of them may be absent.
export function buildBrokerCopyText({ row, risk, brokerName, load }) {
  const v = risk || null

  const line1 = [row?.driver_name, row?.load_number].filter(Boolean).join(' · ') || 'Load —'
  const line2 = [
    brokerName || null,
    v?.mc_number ? `MC ${v.mc_number}` : null,
    v?.carrier_name || null,
  ].filter(Boolean).join(' · ')

  const from = stopShort(row?.origin_city, row?.origin_state)
  const to = stopShort(row?.destination_city, row?.destination_state)
  const lane = from || to ? `${from || '—'} → ${to || '—'}` : null
  const pu = shortDay(row?.pickup_date), del = shortDay(row?.delivery_date)
  const when = pu || del ? `${pu || '—'} → ${del || '—'}` : null
  const line3 = [lane, when].filter(Boolean).join(' · ')

  const alerts = riskWarningLines(v, load)
  // "No broker flags on record" was wrong once load alerts existed: a clean
  // broker with a POD deadline would have printed it and hidden a real alert.
  const body = alerts.length ? alerts.join('\n') : 'No alerts on this load.'

  return [line1, line2, line3].filter(Boolean).join('\n') + `\n\n${body}`
}

// Does this row produce any block at all? on_risk_list is kept in the test
// rather than replaced by the three derived flags: it is the column that says
// "this broker is on the list at all", and a flag string nobody anticipated must
// still open the panel.
export const hasAnyBlock = (v) => !!v && (
  v.rts_tone !== 'hidden' ||
  v.on_risk_list === true ||
  v.has_credit_event === true ||
  v.has_advance_fee === true
)
