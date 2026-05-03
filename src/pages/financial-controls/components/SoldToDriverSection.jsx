import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import CrossReferenceCard from '../../../components/CrossReferenceCard'

function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtFreq(f) {
  if (f === 'weekly') return 'weekly'
  if (f === 'biweekly') return 'biweekly'
  if (f === 'monthly') return 'monthly'
  return f || ''
}

// Reverse lookup — given a loan id, show the driver purchases (if any)
// that point to it via underlying_loan_id. Hides itself when there are
// no rows so the loan detail page stays clean for the common case.
export default function SoldToDriverSection({ loanId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('v_driver_purchase_summary')
        .select('id, driver_name, truck_number, current_balance, payment_amount, payment_frequency, status_name, status_color, is_underwater, coverage_gap, underlying_loan_balance')
        .eq('underlying_loan_id', loanId)
      if (active) {
        setRows(data || [])
        setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [loanId])

  if (loading) return null
  if (!rows.length) return null

  const items = rows.map(r => ({
    primary: r.driver_name,
    secondary: r.truck_number ? `Truck ${r.truck_number}` : '',
    leftRows: [
      { label: 'Driver balance', value: fmtMoney(r.current_balance) },
      { label: 'Payment',        value: r.payment_amount ? `${fmtMoney(r.payment_amount)} ${fmtFreq(r.payment_frequency)}` : '—' },
    ],
    rightRows: [
      { label: 'Bank balance', value: fmtMoney(r.underlying_loan_balance) },
      { label: 'Status',       value: r.status_name },
    ],
    coverage: {
      ok: !r.is_underwater,
      label: r.is_underwater
        ? `Bank balance exceeds driver balance by ${fmtMoney(Math.abs(r.coverage_gap || 0))}`
        : `Driver balance covers bank balance${r.coverage_gap ? ' (+' + fmtMoney(Math.abs(r.coverage_gap)) + ')' : ''}`,
    },
    link: { to: '/financial-controls/driver-purchases', label: 'View driver purchase' },
  }))

  return (
    <CrossReferenceCard
      title={{ singular: 'Sold to driver', plural: 'Sold to drivers' }}
      items={items}
    />
  )
}
