import CrossReferenceCard from '../../../components/CrossReferenceCard'
import { fmtMoney } from '../utils/format'

// Forward direction of the cross-reference. Renders only when the
// purchase has an underlying_loan_id. Reuses the shared
// CrossReferenceCard. Coverage logic mirrors v_driver_purchase_summary:
// underwater = bank balance > driver balance.
export default function UnderlyingLoanCard({ summary }) {
  if (!summary?.underlying_loan_id) return null

  // Once the contract is paid off the bank-vs-driver comparison is stale and
  // misleading (the summary can still carry an old bank balance + a false
  // Underwater flag), so drop the whole note. We only have the dp status here
  // — not the underlying loan's own status — but "Fully Paid" covers it. If we
  // ever need to also key off the loan being paid_off, expose
  // underlying_loan_status on v_driver_purchase_summary.
  const dpFullyPaid = summary.status_name === 'Fully Paid'
    || (summary.is_terminal === true && !!summary.fully_paid_date)
  if (dpFullyPaid) return null

  const driverBal = Number(summary.current_balance || 0)
  const bankBal   = Number(summary.underlying_loan_balance || 0)
  const gap       = Number(summary.coverage_gap || 0)   // bank - driver
  // A driver who owes nothing can't be "underwater" — the driver-vs-bank gap
  // is moot — so never flag it at $0 driver balance, even outside fully-paid.
  const underwater = !!summary.is_underwater && driverBal > 0

  const gapPhrase = underwater
    ? `gap ${fmtMoney(Math.abs(gap))}`
    : `fully covered · gap ${fmtMoney(0)}`
  const detail = `Driver owes ${fmtMoney(driverBal)} · Manas Express owes bank ${fmtMoney(bankBal)}`

  const item = {
    primary: summary.underlying_lender_name || 'Bank loan',
    secondary: summary.underlying_loan_number ? `Loan #${summary.underlying_loan_number}` : '',
    leftRows: [
      { label: 'Bank balance',         value: fmtMoney(bankBal) },
      { label: 'Bank monthly payment', value: fmtMoney(summary.underlying_loan_payment) },
    ],
    rightRows: [
      { label: 'Driver balance', value: fmtMoney(driverBal) },
      { label: 'Driver payment', value: summary.payment_amount ? `${fmtMoney(summary.payment_amount)} ${summary.payment_frequency || ''}` : '—' },
    ],
    coverage: {
      ok: !underwater,
      label: `${gapPhrase}. ${detail}`,
    },
    link: {
      to: `/financial-controls/debt-schedule/${summary.underlying_loan_id}`,
      label: 'View bank loan',
    },
  }

  return (
    <CrossReferenceCard
      title={{ singular: 'Underlying bank loan', plural: 'Underlying bank loans' }}
      items={[item]}
    />
  )
}
