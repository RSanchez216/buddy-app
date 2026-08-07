import {
  ratingCopy, creditTitle, creditBody, feeTitle, feeBody, feeMeta,
  RISK_LIST_TITLE, RISK_LIST_BODY, PANEL_FOOTER, hasAnyBlock,
} from './brokerRiskCopy'

// Broker risk — the 320px column in the expanded shift-board row.
//
// Four blocks, stacked: rating → risk list → credit event → advance fee.
// RTS first, then Apex, then Accounting. That is SOURCE order, not severity
// order, and it stays that way: the one case where source order would mislead —
// a good grade sitting above a red block — is handled by demoting the grade to
// `neutral` in the view, which drops the verdict while keeping the rating
// visible. Do not re-sort by severity.
//
// THE GATING RULE. Apex-sourced blocks render on every carrier; RTS-sourced
// blocks render only where the carrier factors with RTS. Not symmetric, on
// purpose — Apex identity data is useful whoever funds the load, but an RTS
// grade on a USKG or TMS load would tell a dispatcher to call a company USKG has
// no relationship with. rts_tone = 'hidden' encodes this and is trusted here,
// never re-derived from carrier ids.
//
// Every condition reads a boolean column. No presence tests: the view exists
// precisely because a jsonb payload made falsy flags ABSENT, and a presence test
// against that shape mislabelled 1,204 loads.
//
// Copy and formatting live in brokerRiskCopy.js so this file exports components
// only, and so the strings can be asserted against the approved table.

// Accent bar + wash per severity. Hue carries severity, position carries
// category. Titles take the accent colour only for red and amber — emerald and
// slate stay in body text so the common case reads quiet.
const TONE = {
  red: {
    bar: 'bg-[#DC2626] dark:bg-[#F87171]',
    wash: 'bg-[#DC2626]/[0.055] dark:bg-[#F87171]/10',
    title: 'text-[#DC2626] dark:text-[#F87171]',
  },
  amber: {
    bar: 'bg-[#B45309] dark:bg-[#FBBF24]',
    wash: 'bg-[#B45309]/[0.06] dark:bg-[#FBBF24]/10',
    title: 'text-[#B45309] dark:text-[#FBBF24]',
  },
  emerald: {
    bar: 'bg-[#047857] dark:bg-[#34D399]',
    wash: 'bg-[#047857]/[0.055] dark:bg-[#34D399]/[0.09]',
    title: 'text-[#0F172A] dark:text-[#F1F5F9]',
  },
  slate: {
    bar: 'bg-[#64748B] dark:bg-[#94A3B8]',
    wash: 'bg-[#64748B]/[0.045] dark:bg-[#94A3B8]/[0.07]',
    title: 'text-[#0F172A] dark:text-[#F1F5F9]',
  },
}

const BODY = 'text-[#475569] dark:text-[#CBD5E1]'
const META = 'text-[#94A3B8]'

function Block({ tone, chip, title, body, meta, children }) {
  const t = TONE[tone] || TONE.slate
  return (
    <div className="relative overflow-hidden rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B]">
      <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-[3px] ${t.bar}`} />
      <div className={`${t.wash} pl-3 pr-2.5 py-2`}>
        <div className="flex items-start gap-2">
          <p className={`flex-1 min-w-0 text-[12px] font-semibold leading-snug ${t.title}`}>{title}</p>
          <span className={`shrink-0 font-mono text-[8px] uppercase tracking-wider leading-4 ${META}`}>{chip}</span>
        </div>
        {body && <p className={`mt-0.5 text-[11px] leading-snug ${BODY}`}>{body}</p>}
        {meta && <p className={`mt-1 text-[10px] leading-snug ${META}`}>{meta}</p>}
        {children}
      </div>
    </div>
  )
}

export default function BrokerRiskPanel({ risk, carrierName }) {
  if (!hasAnyBlock(risk)) return null
  const rating = ratingCopy(risk)

  return (
    <div className="w-[320px] shrink-0 self-start">
      <h4 className={`text-[10px] font-bold uppercase tracking-widest ${META} mb-1.5`}>Broker risk</h4>

      <div className="flex flex-col gap-1.5">
        {rating && (
          <Block tone={rating.tone} chip="RTS" title={rating.title} body={rating.body} meta={rating.meta}>
            {rating.link && (
              <a href={rating.link.href} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-block text-[10px] font-medium text-[#EA580C] dark:text-[#FB923C] hover:underline">
                {rating.link.label}
              </a>
            )}
          </Block>
        )}

        {risk.on_risk_list === true && (
          <Block tone="red" chip="APEX" title={RISK_LIST_TITLE} body={RISK_LIST_BODY} />
        )}

        {risk.has_credit_event === true && (
          <Block tone="red" chip="APEX" title={creditTitle(risk)} body={creditBody(risk, carrierName)} />
        )}

        {risk.has_advance_fee === true && (
          <Block tone="slate" chip="ACCOUNTING" title={feeTitle(risk)} body={feeBody(risk)} meta={feeMeta(risk)} />
        )}
      </div>

      <p className={`mt-2 text-[10px] leading-snug ${META}`}>{PANEL_FOOTER}</p>
    </div>
  )
}
