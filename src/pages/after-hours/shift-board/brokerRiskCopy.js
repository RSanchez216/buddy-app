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
// "Impersonated", never "bad broker" or "blacklisted": these are companies MANAS
// hauls for daily and the instruction is to VERIFY, not to avoid.
export const RISK_LIST_TITLE = 'On the risk list'
export const RISK_LIST_BODY = 'This broker has been impersonated. Confirm the contact against the rate confirmation before you dispatch.'

// Always shown when at least one block rendered. Nothing above may read as a
// guarantee — recourse applies at every grade, an A included.
export const PANEL_FOOTER = "Factored with recourse — the balance comes back to us if the broker doesn't pay."

// Does this row produce any block at all?
export const hasAnyBlock = (v) => !!v && (
  v.rts_tone !== 'hidden' ||
  v.on_risk_list === true ||
  v.has_credit_event === true ||
  v.has_advance_fee === true
)
