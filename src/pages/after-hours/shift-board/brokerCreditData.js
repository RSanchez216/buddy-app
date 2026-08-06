// Helpers for broker credit events, kept out of BrokerCredit.jsx so that file
// exports components only (fast refresh needs that).
//
// NOTE the filename: brokerCreditData.js, not brokerCredit.js. The latter would
// differ from BrokerCredit.jsx only by case, which resolves to the same module on
// a case-insensitive filesystem — that collision silently emptied a module's
// exports once already on this project, and only showed up at bundle time.

export const usdAmount = (n) => (n == null ? null : `$${Number(n).toLocaleString('en-US')}`)

export const isNoCredit = (c) => c?.event_type === 'no_credit'

// 'Jan 22' / 'Jan 22, 2026' — built from the date parts so a date-only value
// can't shift a day through UTC.
export function fmtEventDate(v, withYear = false) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  const opts = { month: 'short', day: 'numeric' }
  if (withYear) opts.year = 'numeric'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', opts)
}

// Calendar days since a 'YYYY-MM-DD', matching what the board shows.
//
// The board's days_active is Postgres `current_date - active_from`: a count of
// calendar days. Reproducing that in JS needs BOTH anchors right, and the
// obvious version gets both wrong:
//
//   - Subtract local Date objects and a span crossing spring-forward is an hour
//     short of a whole number of days, so floor() drops one. That is not a rare
//     edge — it made Raven Cargo read 195 days against the board's 196 and
//     Yellow Diamond 169 against 170. Doing the arithmetic in UTC, where every
//     day is exactly 86400000ms, removes the shift entirely.
//   - "Today" from the browser clock is the viewer's midnight, not Chicago's.
//     An associate opening the profile at 11pm Pacific would see a day fewer
//     than the board did. Chicago is the operating day everywhere in BUDDY, so
//     it is the anchor here too.
export function daysSince(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3])
  // en-CA gives 'YYYY-MM-DD', so Chicago's current date parses the same way.
  const t = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!t) return null
  return Math.round((Date.UTC(+t[1], +t[2] - 1, +t[3]) - then) / 86400000)
}

// Body copy by type. Written for the person actually reading it.
//
// no_credit's source wording is "DO NOT book loads with them" — but the shift
// board is POST-event. If a load is on the board it is already booked and
// probably already hauled, so advice about a booking decision is advice about
// something that has already happened. The instruction that still applies is:
// get the paperwork in, tell Accounting, and don't take the NEXT one.
//
// limit_reduced is not a fraud signal at all. MANAS has hauled past what Apex
// will cover; prompt paperwork is literally what turns that exposure back into
// cash, so the message leads on the POD rather than on the risk.
export function creditCopy(c) {
  if (isNoCredit(c)) {
    return {
      title: 'No credit — Apex will not fund this broker',
      body: 'This load is already booked. Get the POD and BOL in immediately and flag it to Accounting. Do not accept further loads from this broker.',
    }
  }
  // Each clause is dropped when its figure is null rather than printing "null" —
  // four of the seven open events are missing one or both.
  const limit = usdAmount(c?.new_limit_usd)
  const over = usdAmount(c?.exceeded_by_usd)
  const cut = limit ? `Apex cut this broker's line to ${limit}` : "Apex cut this broker's line"
  const overClause = over ? `; we're over it by ${over}` : "; we're over it"
  return {
    title: 'Credit limit reduced — paperwork is urgent',
    body: `${cut}${overClause}. Getting the POD and BOL in on time is what gets us paid down. Prioritise this load's paperwork.`,
  }
}

// Tooltip for the row glyph. Same non-accusatory register as the block.
export function creditGlyphTitle(c) {
  if (!c) return ''
  if (isNoCredit(c)) return 'No credit — Apex will not fund this broker. Get the paperwork in and flag it to Accounting.'
  const limit = usdAmount(c.new_limit_usd)
  return limit
    ? `Credit limit reduced to ${limit} — paperwork is urgent`
    : 'Credit limit reduced — paperwork is urgent'
}
