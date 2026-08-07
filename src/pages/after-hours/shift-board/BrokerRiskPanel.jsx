import {
  ratingCopy, creditTitle, creditBody, feeTitle, feeBody, feeMeta,
  IDENTITY_TITLE, IDENTITY_BODY, IDENTITY_CHECKS,
  NONPAYMENT_TITLE, NONPAYMENT_BODY,
  RISK_LIST_TITLE, RISK_LIST_BODY,
  PANEL_FOOTER, hasAnyBlock, hasFlagBlock, riskSourceLine,
} from './brokerRiskCopy'
import { PANEL_HEADING } from './panelChrome'

// Broker risk — the 320px column in the expanded shift-board row.
//
// RENDER ORDER: rating → credit stop → identity → nonpayment → advance fee.
// RTS first, then Apex, then Accounting. Credit sits above the two flag blocks
// because it is the only one that changes what happens tonight; identity and
// nonpayment are standing properties of the company.
//
// The rating deliberately stays quieter than the flag blocks. A grade is a
// score, not an alert — an amber `Rating D` beside an amber nonpayment block
// must not read as one warning printed twice.
//
// THE GATING RULE. Apex-sourced blocks render on every carrier; RTS-sourced
// blocks only where the carrier factors with RTS. rts_tone = 'hidden' encodes
// this and is trusted here, never re-derived from carrier ids.
//
// Every condition reads a boolean column. No presence tests — the view exists
// because a jsonb payload once made falsy flags ABSENT and a presence test then
// mislabelled 1,204 loads.

// Tinted block on a white panel: background, border and title all in one family.
// Body text stays in the normal body colour so four tinted families in a 320px
// column don't turn into four competing colours of prose.
const TONE = {
  violet: {
    box: 'bg-[#F5F3FF] border-[#DDD6FE] dark:bg-[rgba(124,58,237,.17)] dark:border-[rgba(167,139,250,.42)]',
    title: 'text-[#6D28D9] dark:text-[#C4B5FD]',
  },
  amber: {
    box: 'bg-[#FFFBEB] border-[#FDE68A] dark:bg-[rgba(180,83,9,.20)] dark:border-[rgba(251,191,36,.40)]',
    title: 'text-[#B45309] dark:text-[#FCD34D]',
  },
  red: {
    box: 'bg-[#FEF2F2] border-[#FECACA] dark:bg-[rgba(220,38,38,.17)] dark:border-[rgba(248,113,113,.40)]',
    title: 'text-[#DC2626] dark:text-[#FCA5A5]',
  },
  emerald: {
    box: 'bg-[#ECFDF5] border-[#A7F3D0] dark:bg-[rgba(4,120,87,.20)] dark:border-[rgba(52,211,153,.38)]',
    title: 'text-[#047857] dark:text-[#6EE7B7]',
  },
  slate: {
    box: 'bg-[#F8FAFC] border-[#E2E8F0] dark:bg-[rgba(148,163,184,.10)] dark:border-[rgba(148,163,184,.28)]',
    title: 'text-[#64748B] dark:text-[#94A3B8]',
  },
}

const BODY = 'text-gray-600 dark:text-slate-300'
const META = 'text-gray-400 dark:text-slate-500'

// ── Glyphs ──────────────────────────────────────────────────────────────────
// currentColor throughout, so each one inherits its block's title colour.
const G = 'w-3.5 h-3.5 shrink-0 fill-current'

const ShieldGlyph = (p) => (
  <svg aria-hidden viewBox="0 0 20 20" className={G} {...p}>
    <path d="M10 1l7 3v5c0 4.4-3 8.3-7 9.4C6 17.3 3 13.4 3 9V4l7-3z" />
  </svg>
)
// Two concentric circles — a coin, for money owed.
const CoinGlyph = (p) => (
  <svg aria-hidden viewBox="0 0 20 20" className={G} {...p}>
    <path fillRule="evenodd" d="M10 1a9 9 0 100 18 9 9 0 000-18zm0 2a7 7 0 110 14 7 7 0 010-14zm0 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z" clipRule="evenodd" />
  </svg>
)
// Filled rounded square — a hard stop.
const StopGlyph = (p) => (
  <svg aria-hidden viewBox="0 0 20 20" className={G} {...p}>
    <rect x="3" y="3" width="14" height="14" rx="3" />
  </svg>
)
const DollarGlyph = (p) => (
  <svg aria-hidden viewBox="0 0 20 20" className={G} {...p}>
    <path d="M9.1 1.5h1.8v2.1c1.6.1 2.9.7 3.8 1.6l-1.4 1.6c-.7-.7-1.6-1.1-2.4-1.2v3.2c2.4.6 4 1.5 4 3.7 0 2-1.5 3.4-4 3.6v2.4H9.1v-2.4c-1.9-.2-3.4-1-4.4-2.1l1.5-1.5c.8.8 1.8 1.4 2.9 1.5v-3.4c-2.3-.6-3.8-1.5-3.8-3.6 0-2 1.5-3.3 3.8-3.5V1.5zm0 4.1c-1 .1-1.5.6-1.5 1.3 0 .6.3 1 1.5 1.4V5.6zm1.8 8.6c1.1-.1 1.6-.6 1.6-1.3 0-.7-.4-1.1-1.6-1.5v2.8z" />
  </svg>
)
const TickGlyph = (p) => (
  <svg aria-hidden viewBox="0 0 20 20" className={G} {...p}>
    <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
  </svg>
)
// The rating's own mark — an outlined circle, quieter than a filled alert glyph.
const GradeGlyph = (p) => (
  <svg aria-hidden viewBox="0 0 20 20" className={G} {...p}>
    <path fillRule="evenodd" d="M10 1a9 9 0 100 18 9 9 0 000-18zm0 2a7 7 0 110 14 7 7 0 010-14z" clipRule="evenodd" />
  </svg>
)

function Block({ tone, chip, glyph, title, body, meta, children }) {
  const t = TONE[tone] || TONE.slate
  return (
    <div className={`rounded-lg border p-2.5 ${t.box}`}>
      <div className="flex items-start gap-1.5">
        <span className={`mt-px ${t.title}`}>{glyph}</span>
        <p className={`flex-1 min-w-0 text-[12px] font-semibold leading-snug ${t.title}`}>{title}</p>
        <span className={`shrink-0 font-mono text-[8px] uppercase tracking-wider leading-4 ${META}`}>{chip}</span>
      </div>
      {body && <p className={`mt-1 text-[11px] leading-snug ${BODY}`}>{body}</p>}
      {children}
      {meta && <p className={`mt-1 text-[10px] leading-snug ${META}`}>{meta}</p>}
    </div>
  )
}

const RATING_GLYPH = { emerald: TickGlyph, red: StopGlyph, amber: CoinGlyph, slate: GradeGlyph }

export default function BrokerRiskPanel({ risk, carrierName, brokerName }) {
  if (!hasAnyBlock(risk)) return null
  const rating = ratingCopy(risk)
  // `good` earns the tick; every other rating tone keeps the neutral grade mark
  // so a score never borrows an alert's glyph.
  const RatingGlyph = rating ? (rating.tone === 'emerald' ? TickGlyph : GradeGlyph) : null
  const source = riskSourceLine(risk, brokerName)

  return (
    <div className="w-[320px] shrink-0 self-start rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-3.5">
      <h4 className={PANEL_HEADING}>Broker risk</h4>

      <div className="mt-3 flex flex-col gap-1.5">
        {rating && (
          <Block tone={rating.tone} chip="RTS" glyph={<RatingGlyph />}
            title={rating.title} body={rating.body} meta={rating.meta}>
            {rating.link && (
              <a href={rating.link.href} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-block text-[10px] font-medium text-[#EA580C] dark:text-[#FB923C] hover:underline">
                {rating.link.label}
              </a>
            )}
          </Block>
        )}

        {/* Credit stop above the standing flags: it is the only one that changes
            what happens tonight. */}
        {risk.has_credit_event === true && (
          <Block tone="red" chip="APEX" glyph={<StopGlyph />}
            title={creditTitle(risk)} body={creditBody(risk, carrierName)} />
        )}

        {risk.risk_identity === true && (
          <Block tone="violet" chip="APEX" glyph={<ShieldGlyph />}
            title={IDENTITY_TITLE} body={IDENTITY_BODY}>
            <ul className={`mt-1 space-y-0.5 text-[11px] leading-snug ${BODY}`}>
              {IDENTITY_CHECKS.map(c => <li key={c}>· {c}</li>)}
            </ul>
          </Block>
        )}

        {risk.risk_nonpayment === true && (
          <Block tone="amber" chip="APEX" glyph={<CoinGlyph />}
            title={NONPAYMENT_TITLE} body={NONPAYMENT_BODY} />
        )}

        {risk.risk_unclassified === true && (
          <Block tone="slate" chip="APEX" glyph={<ShieldGlyph />}
            title={RISK_LIST_TITLE} body={RISK_LIST_BODY} />
        )}

        {risk.has_advance_fee === true && (
          <Block tone="slate" chip="ACCOUNTING" glyph={<DollarGlyph />}
            title={feeTitle(risk)} body={feeBody(risk)} meta={feeMeta(risk)} />
        )}
      </div>

      {hasFlagBlock(risk) && source && (
        <p className={`mt-2 text-[10px] italic leading-snug ${META} break-words`}>{source}</p>
      )}

      <p className={`mt-2 pt-2 border-t border-gray-100 dark:border-white/5 text-[10px] leading-snug ${META}`}>
        {PANEL_FOOTER}
      </p>
    </div>
  )
}
