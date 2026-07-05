import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// LoadsFreshness — a small "last updated" stamp for loads-backed views.
// Answers "how current is the freight data?" — distinct from any date-range
// filter, which is about *when loads happened*, not when data was refreshed.
//
// Fetches get_loads_freshness() once on mount. Never blocks the parent's
// render; shows a faint placeholder until the RPC resolves, then the stamp.
// Standalone by design so it can drop onto Profitability, the Loads page,
// Payment Calendar, etc.

const CT = 'America/Chicago'

// Wall-clock timestamp in Chicago, e.g. "Jun 29, 9:57 AM CT".
function fmtImport(iso) {
  const d = new Date(iso)
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: CT, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d)
  return `${s} CT`
}

// Chicago calendar day (YYYY-MM-DD) for any Date.
function ctDayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CT }).format(d)
}

// Format a date-only value ("2026-07-02") without any timezone shift — these
// are calendar dates, not instants, so parse the parts directly. → "Jul 2".
function fmtDateOnly(ymd) {
  if (!ymd) return null
  const [y, m, day] = String(ymd).slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return null
  // Noon UTC + UTC formatter keeps the intended calendar day intact.
  const d = new Date(Date.UTC(y, m - 1, day, 12))
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d)
}

// Whole days between the import instant and now, both in Chicago calendar days.
function ageInDays(iso) {
  const importKey = ctDayKey(new Date(iso))
  const todayKey = ctDayKey(new Date())
  const a = new Date(`${importKey}T00:00:00Z`)
  const b = new Date(`${todayKey}T00:00:00Z`)
  return Math.round((b - a) / 864e5)
}

export default function LoadsFreshness({ className = '' }) {
  const [row, setRow] = useState(null)
  const [state, setState] = useState('loading') // 'loading' | 'ready' | 'error'

  useEffect(() => {
    let stale = false
    supabase.rpc('get_loads_freshness')
      .then(({ data, error }) => {
        if (stale) return
        const r = !error && Array.isArray(data) && data.length ? data[0] : null
        if (r && r.last_import_applied) { setRow(r); setState('ready') }
        else setState('error')
      })
      .catch(() => { if (!stale) setState('error') })
    return () => { stale = true }
  }, [])

  if (state === 'loading') {
    return (
      <span className={`text-[11px] text-gray-400 dark:text-slate-600 ${className}`}>
        Checking freshness…
      </span>
    )
  }
  if (state === 'error' || !row) return null

  const age = ageInDays(row.last_import_applied)
  const updated = fmtImport(row.last_import_applied)
  const through = fmtDateOnly(row.data_through)
  const rel = age > 0 ? `(${age} day${age === 1 ? '' : 's'} ago)` : null

  const behind = age > 3          // gentle flag territory
  const amber = age >= 2          // amber from 2 days on

  const tone = amber
    ? 'text-amber-700 dark:text-amber-400'
    : 'text-gray-500 dark:text-slate-500'

  // Assemble one muted line. Warning form prepends ⚠ and appends the hint,
  // but keeps the same core "Loads updated … · data through …" shape.
  const core = [
    `Loads updated ${updated}`,
    through ? `· data through ${through}` : null,
    rel,
  ].filter(Boolean).join(' ')

  const text = behind ? `⚠ ${core} — data may be behind.` : core

  const title = `Freight data last refreshed ${updated}${through ? `; newest delivery date ${through}` : ''}. `
    + `This is when loads were last imported — separate from the date-range filter above.`

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${tone} ${className}`} title={title}>
      {!behind && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${amber ? 'bg-amber-500' : 'bg-emerald-500'}`}
          aria-hidden="true"
        />
      )}
      {text}
    </span>
  )
}
