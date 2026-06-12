import { useEffect, useRef, useState, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import { parseFuelPriceWorkbook } from './fuelPricesParse'

function fmtDate(d) {
  if (!d) return '—'
  if (typeof d === 'string') d = new Date(d)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    })
  } catch { return '—' }
}

function fmtPrice(n) {
  if (n == null) return '—'
  return '$' + Number(n).toFixed(4)
}

const PAGE_SIZE = 50

export default function FuelPrices() {
  const { user, canEdit } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)

  // State
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [recent, setRecent] = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [offers, setOffers] = useState([])
  const [offersLoading, setOffersLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [sortCol, setSortCol] = useState('site_int')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)

  // Load recent imports and latest effective_date
  useEffect(() => {
    loadRecent()
  }, [])

  async function loadRecent() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('fuel_price_reports')
        .select('*')
        .order('effective_date', { ascending: false })
        .limit(10)

      if (error) throw error

      setRecent(data || [])
      // Auto-select the latest effective_date
      if (data && data.length > 0) {
        const latestDate = new Date(data[0].effective_date)
        setSelectedDate(latestDate.toISOString().split('T')[0])
      }
    } catch (err) {
      toast.error('Failed to load recent imports', err.message)
    } finally {
      setLoading(false)
    }
  }

  // Load offers for selected date
  useEffect(() => {
    if (selectedDate) {
      loadOffers()
    } else {
      setOffers([])
    }
  }, [selectedDate])

  async function loadOffers() {
    setOffersLoading(true)
    try {
      const { data, error } = await supabase
        .from('fuel_price_offers')
        .select('*')
        .eq('effective_date', selectedDate)
        .order(sortCol, { ascending: sortDir === 'asc' })

      if (error) throw error
      setOffers(data || [])
      setPage(0)
    } catch (err) {
      toast.error('Failed to load offers', err.message)
    } finally {
      setOffersLoading(false)
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const buf = await file.arrayBuffer()
      const { headerData, offers: parsedOffers, errors } = parseFuelPriceWorkbook(buf)

      if (errors.length) {
        toast.error("Parse error", errors[0])
        return
      }

      if (!headerData.account || !headerData.effective_date || !parsedOffers.length) {
        toast.error('Missing required data', 'Account, effective date, or offers')
        return
      }

      // Upsert report
      const effectiveDateStr = headerData.effective_date.toISOString().split('T')[0]

      // First, check if report exists
      const { data: existing } = await supabase
        .from('fuel_price_reports')
        .select('id')
        .eq('account', headerData.account)
        .eq('effective_date', effectiveDateStr)
        .single()

      let reportId
      if (existing) {
        // Delete old offers
        await supabase.from('fuel_price_offers').delete().eq('report_id', existing.id)
        reportId = existing.id
      } else {
        // Insert new report
        const { data: newReport, error: reportErr } = await supabase
          .from('fuel_price_reports')
          .insert({
            account: headerData.account,
            effective_date: effectiveDateStr,
            price_source: headerData.price_source,
            provider: headerData.provider,
            retail_as_of: headerData.retail_as_of,
            filename: file.name,
            total_sites: parsedOffers.length,
            status: 'applied',
            uploaded_by: user?.id,
          })
          .select('id')
          .single()

        if (reportErr) throw reportErr
        reportId = newReport.id
      }

      // Insert offers with progress tracking
      const batchSize = 100
      for (let i = 0; i < parsedOffers.length; i += batchSize) {
        const batch = parsedOffers.slice(i, i + batchSize)
        const offersToInsert = batch.map(o => ({
          report_id: reportId,
          effective_date: effectiveDateStr,
          ...o,
        }))

        const { error: offersErr } = await supabase
          .from('fuel_price_offers')
          .insert(offersToInsert)

        if (offersErr) throw offersErr
      }

      toast.success(`Imported ${parsedOffers.length} sites for ${effectiveDateStr}`)
      setSelectedDate(effectiveDateStr)
      await loadRecent()
    } catch (err) {
      toast.error('Import failed', err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Filter and paginate offers
  const filtered = useMemo(() => {
    const text = searchText.toLowerCase()
    return offers.filter(o =>
      String(o.site_int).includes(text) ||
      (o.city || '').toLowerCase().includes(text)
    )
  }, [offers, searchText])

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Fuel Prices</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Daily diesel price reports from Pilot/Flying J
          </p>
        </div>
        {canEdit && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".xls,.xlsx"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={S.btnPrimary}
            >
              {uploading ? 'Uploading…' : 'Upload daily report'}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="px-4 py-12 text-center">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
        </div>
      ) : (
        <>
          {/* Recent imports */}
          {recent.length > 0 && (
            <div className={`${S.card} p-4`}>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Recent imports</h2>
              <div className="divide-y divide-gray-100 dark:divide-white/5">
                {recent.map(r => {
                  const isSelected = selectedDate === r.effective_date
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedDate(r.effective_date)}
                      className={`w-full text-left py-2.5 px-0 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors ${
                        isSelected ? 'bg-blue-50/50 dark:bg-blue-500/[0.06]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`text-sm font-medium ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-slate-200'}`}>
                          {fmtDate(r.effective_date)}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">
                          {r.total_sites} sites
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400 dark:text-slate-500">
                        {fmtDateTime(r.uploaded_at)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Viewer */}
          {selectedDate && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-sm text-gray-500 dark:text-slate-400">Effective date:</h2>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className={`${S.input} w-auto text-sm`}
                  />
                </div>
                <div className="w-full sm:w-auto">
                  <input
                    type="text"
                    placeholder="Search site or city…"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className={S.input}
                  />
                </div>
              </div>

              {offersLoading ? (
                <div className="px-4 py-8 text-center">
                  <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
                </div>
              ) : offers.length === 0 ? (
                <div className={`${S.card} p-8 text-center`}>
                  <p className="text-sm text-gray-500 dark:text-slate-400">No data for this date</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className={S.tableHead}>
                        <tr>
                          <SortHeader col="site_int" label="Site" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          <SortHeader col="city" label="City" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          <SortHeader col="st" label="ST" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          <SortHeader col="cost" label="Cost" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                          <SortHeader col="your_price" label="Your Price" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                          <SortHeader col="retail_price" label="Retail Price" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                          <SortHeader col="savings_total" label="Savings Total" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map((o) => (
                          <tr key={o.id} className={S.tableRow}>
                            <td className={`${S.td} font-mono`}>{o.site_int}</td>
                            <td className={S.td}>{o.city || '—'}</td>
                            <td className={S.td}>{o.st || '—'}</td>
                            <td className={`${S.td} text-right font-mono`}>{fmtPrice(o.cost)}</td>
                            <td className={`${S.td} text-right font-mono text-blue-700 dark:text-blue-300 font-semibold`}>{fmtPrice(o.your_price)}</td>
                            <td className={`${S.td} text-right font-mono`}>{fmtPrice(o.retail_price)}</td>
                            <td className={`${S.td} text-right font-mono`}>{fmtPrice(o.savings_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {pageCount > 1 && (
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
                      <span>{filtered.length} results</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPage(Math.max(0, page - 1))}
                          disabled={page === 0}
                          className="px-2 py-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-50"
                        >
                          ← Prev
                        </button>
                        <span>
                          Page {page + 1} of {pageCount}
                        </span>
                        <button
                          onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
                          disabled={page >= pageCount - 1}
                          className="px-2 py-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-50"
                        >
                          Next →
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function SortHeader({ col, label, sortCol, sortDir, onSort, align = 'left' }) {
  const isSorted = col === sortCol
  return (
    <th className={`${S.th} ${align === 'right' ? 'text-right' : ''} cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]`} onClick={() => onSort(col)}>
      <span className="flex items-center gap-1 justify-between">
        {label}
        {isSorted && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}
