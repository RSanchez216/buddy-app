import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { S } from '../lib/styles'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import DeptBadge from '../components/DeptBadge'
import Select from '../components/Select'
import MultiSelect from '../components/MultiSelect'
import { buildDeptOptions, pmLabel } from '../lib/deptUtils'
import { useToast } from '../contexts/ToastContext'
import { Link } from 'react-router-dom'

const FREQUENCIES = ['Weekly', 'Bi-Weekly', 'Monthly', 'Yearly', 'One-Time']

const emptyForm = {
  name: '', category_id: '', frequency: 'Monthly',
  payment_method_id: '', department_ids: [], expected_amount_min: '', expected_amount_max: '', is_active: true,
}

export default function VendorMaster() {
  const { profile } = useAuth()
  const toast = useToast()
  const [vendors, setVendors] = useState([])
  const [departments, setDepartments] = useState([])
  const [categories, setCategories] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editVendor, setEditVendor] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [aliases, setAliases] = useState([])
  const [newAlias, setNewAlias] = useState('')
  const [aliasLoading, setAliasLoading] = useState(false)
  // Leased equipment for this vendor — only populated when the modal opens
  // on an Equipment Rental vendor. List of { etype, id, unit_number, vin,
  // monthly_cost, weekly_cost } drawn from the fleet_equipment_cost view.
  const [leasedEquipment, setLeasedEquipment] = useState([])
  const [leasedEquipmentLoading, setLeasedEquipmentLoading] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])
  const fileRef = useRef()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [vendRes, deptRes, catRes, pmRes] = await Promise.all([
      supabase.from('vendors').select('*, departments(name), vendor_categories(name), payment_methods(name, account_reference)').order('name'),
      supabase.from('departments').select('*').eq('is_active', true).order('name'),
      supabase.from('vendor_categories').select('*').order('name'),
      supabase.from('payment_methods').select('*').order('name'),
    ])
    setVendors(vendRes.data || [])
    setDepartments(deptRes.data || [])
    setCategories(catRes.data || [])
    setPaymentMethods(pmRes.data || [])
    setLoading(false)
  }

  const deptOptions = buildDeptOptions(departments)

  const filtered = vendors.filter(v => {
    const catName = v.vendor_categories?.name || v.category || ''
    const matchSearch = !search || v.name.toLowerCase().includes(search.toLowerCase()) || catName.toLowerCase().includes(search.toLowerCase())
    const deptIds = v.department_ids?.length ? v.department_ids : (v.department_id ? [v.department_id] : [])
    const matchDept = !filterDept || deptIds.includes(filterDept)
    const matchCat = !filterCat || v.category_id === filterCat
    return matchSearch && matchDept && matchCat
  })

  function openAdd() { setEditVendor(null); setForm(emptyForm); setError(''); setShowModal(true) }
  function openEdit(v) {
    setEditVendor(v)
    setForm({
      name: v.name,
      category_id: v.category_id || '',
      frequency: v.frequency,
      payment_method_id: v.payment_method_id || '',
      department_ids: v.department_ids?.length ? v.department_ids : (v.department_id ? [v.department_id] : []),
      expected_amount_min: v.expected_amount_min || '',
      expected_amount_max: v.expected_amount_max || '',
      is_active: v.is_active,
    })
    setError(''); setNewAlias(''); loadAliases(v.id); setShowModal(true)
    // Side-load leased equipment when the vendor's category is the lessor
    // convention. Other categories skip the fetch.
    const isEquipmentRental = (v.vendor_categories?.name || v.category) === 'Equipment Rental'
    setLeasedEquipment([])
    if (isEquipmentRental) loadLeasedEquipment(v.id)
  }

  async function loadLeasedEquipment(vendorId) {
    setLeasedEquipmentLoading(true)
    // Pull from the cost view (gives us monthly/weekly equivs) AND from
    // the unit tables (gives us the editable native lease_cost +
    // lease_cost_period + lease_cost_per_mile) so the editor can
    // round-trip without re-deriving anything client-side.
    const [{ data: cost }, { data: trucks }, { data: trailers }] = await Promise.all([
      supabase.from('fleet_equipment_cost')
        .select('etype, id, unit_number, vin, monthly_cost, weekly_cost, per_mile_rate')
        .eq('lessor_vendor_id', vendorId)
        .order('etype').order('unit_number'),
      supabase.from('trucks')
        .select('id, lease_cost, lease_cost_period, lease_cost_per_mile')
        .eq('lessor_vendor_id', vendorId),
      supabase.from('trailers')
        .select('id, lease_cost, lease_cost_period, lease_cost_per_mile')
        .eq('lessor_vendor_id', vendorId),
    ])
    const editableByKey = new Map()
    for (const t of (trucks || []))   editableByKey.set(`truck:${t.id}`, t)
    for (const t of (trailers || [])) editableByKey.set(`trailer:${t.id}`, t)
    const rows = (cost || []).map(c => {
      const k = `${c.etype}:${c.id}`
      const e = editableByKey.get(k)
      return {
        ...c,
        lease_cost:          e?.lease_cost ?? null,
        lease_cost_period:   e?.lease_cost_period || 'monthly',
        lease_cost_per_mile: e?.lease_cost_per_mile ?? null,
      }
    })
    setLeasedEquipment(rows)
    setLeasedEquipmentLoading(false)
  }

  async function loadAliases(vendorId) {
    setAliasLoading(true)
    const { data } = await supabase.from('vendor_aliases').select('id, alias, created_at').eq('vendor_id', vendorId).order('created_at')
    setAliases(data || [])
    setAliasLoading(false)
  }

  async function addAlias() {
    const trimmed = newAlias.trim()
    if (!trimmed || !editVendor) return
    const { error } = await supabase.from('vendor_aliases').insert({ vendor_id: editVendor.id, alias: trimmed })
    if (error) toast.error("Couldn't add alias", error)
    else toast.success(`Alias added — ${trimmed}`)
    setNewAlias('')
    loadAliases(editVendor.id)
  }

  async function deleteAlias(id) {
    const { error } = await supabase.from('vendor_aliases').delete().eq('id', id)
    if (error) toast.error("Couldn't delete alias", error)
    else toast.success('Alias deleted')
    setAliases(prev => prev.filter(a => a.id !== id))
  }

  async function handleSave() {
    if (!form.name.trim()) return setError('Vendor name is required')
    if (!form.department_ids.length) return setError('At least one department is required')
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      category: categories.find(c => c.id === form.category_id)?.name || null,
      frequency: form.frequency,
      payment_method_id: form.payment_method_id || null,
      payment_method: paymentMethods.find(p => p.id === form.payment_method_id)?.name || null,
      department_ids: form.department_ids,
      department_id: form.department_ids[0] || null, // backward compat
      expected_amount_min: Number(form.expected_amount_min) || 0,
      expected_amount_max: Number(form.expected_amount_max) || 0,
      is_active: form.is_active,
    }
    const res = editVendor
      ? await supabase.from('vendors').update(payload).eq('id', editVendor.id)
      : await supabase.from('vendors').insert(payload)
    if (res.error) {
      setError(res.error.message)
      toast.error(editVendor ? "Couldn't update vendor" : "Couldn't create vendor", res.error)
    } else {
      toast.success(editVendor ? `Vendor updated — ${payload.name}` : `Vendor created — ${payload.name}`)
      setShowModal(false); loadData()
    }
    setSaving(false)
  }

  async function toggleActive(v) {
    const { error } = await supabase.from('vendors').update({ is_active: !v.is_active }).eq('id', v.id)
    if (error) toast.error(v.is_active ? "Couldn't deactivate vendor" : "Couldn't reactivate vendor", error)
    else toast.success(v.is_active ? `Vendor deactivated — ${v.name}` : `Vendor reactivated — ${v.name}`)
    loadData()
  }

  // ── Excel template download ─────────────────────────────────────────────
  function downloadTemplate() {
    const headers = ['Vendor Name', 'Category', 'Frequency', 'Payment Method', 'Department', 'Min Amount', 'Max Amount', 'Active (Yes/No)']
    const example = [
      'Pilot Flying J',
      categories[0]?.name || 'Fuel',
      'Monthly',
      paymentMethods[0]?.name || 'ACH',
      departments[0]?.name || 'Fleet',
      '4500',
      '5500',
      'Yes',
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, example])
    ws['!cols'] = headers.map((_, i) => ({ wch: [20, 20, 12, 18, 15, 12, 12, 14][i] }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Vendors')
    XLSX.writeFile(wb, 'buddy_vendor_import_template.xlsx')
  }

  // ── Excel import ────────────────────────────────────────────────────────
  const REQUIRED_COLS = ['Vendor Name', 'Department']

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)

      if (!rows.length) { toast.error('The file appears to be empty.'); return }

      const firstRow = Object.keys(rows[0])
      const missing = REQUIRED_COLS.filter(c => !firstRow.includes(c))
      if (missing.length) { toast.error('Missing required columns', `${missing.join(', ')} — see the template for the expected format.`); return }

      setImportRows(rows.map((r, i) => {
        const deptName = r['Department'] || ''
        const catName = r['Category'] || ''
        const pmName = r['Payment Method'] || ''
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        const cat = categories.find(c => c.name.toLowerCase() === catName.toLowerCase())
        const pm = paymentMethods.find(p => p.name.toLowerCase() === pmName.toLowerCase())
        const errs = []
        if (!r['Vendor Name']) errs.push('Missing vendor name')
        if (!dept) errs.push(`Dept "${deptName}" not found`)
        return {
          _row: i + 2,
          name: r['Vendor Name'] || '',
          category_id: cat?.id || null,
          category: catName,
          category_name: cat?.name || catName,
          frequency: r['Frequency'] || 'Monthly',
          payment_method_id: pm?.id || null,
          payment_method: pmName,
          department_ids: dept ? [dept.id] : [],
          department_id: dept?.id || null,
          department_name: deptName,
          expected_amount_min: Number(String(r['Min Amount'] || '0').replace(/[$,]/g, '')) || 0,
          expected_amount_max: Number(String(r['Max Amount'] || '0').replace(/[$,]/g, '')) || 0,
          is_active: String(r['Active (Yes/No)'] || 'Yes').toLowerCase() !== 'no',
          _error: errs.length ? errs.join('; ') : null,
        }
      }))
      setShowImport(true)
    }
    reader.readAsArrayBuffer(file); e.target.value = ''
  }

  async function confirmImport() {
    const valid = importRows.filter(r => !r._error)
    if (!valid.length) return
    const payload = valid.map(({ _row, _error, category, payment_method, department_name, category_name, ...rest }) => ({
      ...rest,
      category: category_name,
      payment_method,
    }))
    const res = await supabase.from('vendors').insert(payload)
    if (res.error) toast.error('Import failed', res.error)
    else {
      const skipped = importRows.filter(r => r._error).length
      toast.success(
        `Imported ${valid.length} vendor${valid.length > 1 ? 's' : ''}`,
        skipped ? { description: `${skipped} row${skipped === 1 ? '' : 's'} skipped due to errors.` } : undefined
      )
      setShowImport(false); loadData()
    }
  }

  // Helper: get dept names for a vendor
  function vendorDeptNames(v) {
    const ids = v.department_ids?.length ? v.department_ids : (v.department_id ? [v.department_id] : [])
    return ids.map(id => departments.find(d => d.id === id)?.name).filter(Boolean)
  }

  // Helper: format amount range
  function fmtRange(v) {
    const min = Number(v.expected_amount_min)
    const max = Number(v.expected_amount_max)
    if (!min && !max) return '—'
    if (!max) return `≥ $${min.toLocaleString()}`
    if (!min) return `≤ $${max.toLocaleString()}`
    return `$${min.toLocaleString()} – $${max.toLocaleString()}`
  }

  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Vendor Master</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">{vendors.filter(v => v.is_active).length} active vendors</p>
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={downloadTemplate} className={S.btnSecondary} title="Download blank .xlsx template">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Template
            </button>
            <input type="file" accept=".xlsx" ref={fileRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileRef.current.click()} className={S.btnSecondary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import Excel
            </button>
            <button onClick={openAdd} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Vendor
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input type="text" placeholder="Search by name or category…" value={search} onChange={e => setSearch(e.target.value)}
          className={`${S.input} w-56`} />
        <Select value={filterDept} onChange={e => setFilterDept(e.target.value)}>
          <option value="">All Departments</option>
          {deptOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
        <Select value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      {/* Table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Name', 'Category', 'Frequency', 'Payment Method', 'Department(s)', 'Amt Range', 'Status', canEdit && ''].filter(Boolean).map(h => (
                  <th key={h} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No vendors found</td></tr>
              ) : filtered.map(v => (
                <tr key={v.id} className={S.tableRow}>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{v.name}</td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{v.vendor_categories?.name || v.category || '—'}</td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{v.frequency}</td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400`}>
                    {v.payment_methods ? pmLabel(v.payment_methods) : (v.payment_method || '—')}
                  </td>
                  <td className={S.td}>
                    <div className="flex flex-wrap gap-1">
                      {vendorDeptNames(v).slice(0, 2).map(name => <DeptBadge key={name} name={name} />)}
                      {vendorDeptNames(v).length > 2 && (
                        <span className="text-xs text-gray-400 dark:text-slate-500 self-center">+{vendorDeptNames(v).length - 2}</span>
                      )}
                      {vendorDeptNames(v).length === 0 && <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </div>
                  </td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400 text-xs font-mono whitespace-nowrap`}>{fmtRange(v)}</td>
                  <td className={`${S.td} text-center`}><StatusBadge status={v.is_active ? 'Active' : 'Inactive'} /></td>
                  {canEdit && (
                    <td className={`${S.td} text-right`}>
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openEdit(v)} className="text-gray-400 dark:text-slate-600 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => toggleActive(v)} className={`text-xs font-medium transition-colors ${v.is_active ? 'text-gray-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400' : 'text-gray-400 dark:text-slate-600 hover:text-emerald-600 dark:hover:text-emerald-400'}`}>
                          {v.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal — bumped to 2xl so the inline-editable Leased
          Equipment table has room and the vendor fields can sit in two
          columns side-by-side. */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editVendor ? 'Edit Vendor' : 'Add Vendor'} size="2xl">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          {/* Vendor fields — 2-column grid. Wide fields (Departments,
              Expected Amount Range, Aliases) span both columns; pairs
              (Name + Category, Frequency + Payment Method) sit
              side-by-side. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className={S.label}>Vendor Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={S.input} />
            </div>
            <div>
              <label className={S.label}>Category</label>
              <Select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                <option value="">Select…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <label className={S.label}>Frequency</label>
              <Select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div>
              <label className={S.label}>Payment Method</label>
              <Select value={form.payment_method_id} onChange={e => setForm(f => ({ ...f, payment_method_id: e.target.value }))}>
                <option value="">Select…</option>
                {paymentMethods.map(p => <option key={p.id} value={p.id}>{pmLabel(p)}</option>)}
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className={S.label}>Department(s) *</label>
              <MultiSelect
                options={deptOptions}
                value={form.department_ids}
                onChange={ids => setForm(f => ({ ...f, department_ids: ids }))}
                placeholder="Select department(s)…"
              />
            </div>
            <div className="md:col-span-2">
              <label className={S.label}>Expected Amount Range ($)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0"
                  value={form.expected_amount_min}
                  onChange={e => setForm(f => ({ ...f, expected_amount_min: e.target.value }))}
                  className={S.input} placeholder="Min"
                />
                <span className="text-gray-400 dark:text-slate-500 text-sm shrink-0">to</span>
                <input
                  type="number" min="0"
                  value={form.expected_amount_max}
                  onChange={e => setForm(f => ({ ...f, expected_amount_max: e.target.value }))}
                  className={S.input} placeholder="Max"
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Transactions outside this range will be flagged</p>
            </div>
          </div>

          {/* Aliases section — edit mode only */}
          {editVendor && (
            <div>
              <label className={S.label}>Aliases</label>
              <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">
                Alternative names used in automated imports (Parseur). Invoices matching these names will auto-assign to this vendor.
              </p>

              {aliasLoading ? (
                <p className="text-xs text-gray-400 dark:text-slate-500">Loading…</p>
              ) : (
                <>
                  {aliases.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {aliases.map(a => (
                        <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-white/5 rounded-xl">
                          <span className="text-sm text-gray-700 dark:text-slate-300 font-mono">{a.alias}</span>
                          <button
                            type="button"
                            onClick={() => deleteAlias(a.id)}
                            className="text-gray-300 dark:text-slate-600 hover:text-red-500 transition-colors ml-2 shrink-0"
                            title="Remove alias"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={newAlias}
                      onChange={e => setNewAlias(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addAlias()}
                      className={`${S.input} flex-1`}
                      placeholder="Add alias (e.g. Vanguard Truck Centers)"
                    />
                    <button
                      type="button"
                      onClick={addAlias}
                      disabled={!newAlias.trim()}
                      className="px-3 py-2 rounded-xl bg-cyan-500 text-white text-sm font-semibold hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      Add
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Leased Equipment — inline-editable cost table for Equipment
              Rental vendors. Each row's Fixed cost / Period / Per-mile
              writes back to the unit's columns. Bulk apply lets the
              user push the same Fixed/Period/Per-mile to a multi-
              select of rows in one shot — handy when a vendor raises
              the price or 10 new units come online from one lessor.
              Reads and writes the same source as the truck/trailer
              edit forms, so the two screens stay in sync. */}
          {editVendor && leasedEquipmentLoading && (
            <p className="text-xs text-gray-400 dark:text-slate-500 italic">Loading leased equipment…</p>
          )}
          {editVendor && !leasedEquipmentLoading && leasedEquipment.length > 0 && (
            <LeasedEquipmentEditor
              rows={leasedEquipment}
              onSaved={() => loadLeasedEquipment(editVendor.id)}
              onClose={() => setShowModal(false)}
            />
          )}

          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editVendor ? 'Update Vendor' : 'Add Vendor'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import Preview Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Vendors — Preview" size="xl">
        <div className="p-5">
          <div className="flex gap-4 mb-4 text-sm flex-wrap">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{importRows.filter(r => !r._error).length} rows ready</span>
            {importRows.filter(r => r._error).length > 0 && (
              <span className="text-red-600 dark:text-red-400 font-semibold">{importRows.filter(r => r._error).length} rows with errors (will be skipped)</span>
            )}
          </div>
          <div className="overflow-x-auto max-h-96 border border-gray-200 dark:border-white/5 rounded-xl overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-[#09091a] sticky top-0">
                <tr>{['Row', 'Name', 'Category', 'Frequency', 'Payment', 'Department', 'Min $', 'Max $', 'Active', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-gray-500 dark:text-slate-500 font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {importRows.map(r => (
                  <tr key={r._row} className={`border-b border-gray-50 dark:border-white/[0.03] ${r._error ? 'bg-red-50 dark:bg-red-500/5' : ''}`}>
                    <td className="px-3 py-2 text-gray-400 dark:text-slate-600">{r._row}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-slate-200 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.category_name}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.frequency}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.payment_method}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.department_name}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">${r.expected_amount_min}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">${r.expected_amount_max}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.is_active ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2">
                      {r._error ? <span className="text-red-600 dark:text-red-400">{r._error}</span> : <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${S.modalFooter} mt-4`}>
            <button onClick={() => setShowImport(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={confirmImport} disabled={!importRows.filter(r => !r._error).length} className={S.btnSave}>
              Import {importRows.filter(r => !r._error).length} Vendors
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// LeasedEquipmentEditor — inline-editable table for the vendor profile.
// Each row owns a `draft` object (lease_cost / period / per_mile) that
// diverges from the loaded value once the user types. The footer "Save
// changes" button writes only the dirty rows. Bulk apply pushes the
// header form's values into every selected row's draft (no DB write
// until Save).
//
// The draft state is keyed by `${etype}:${id}` so trucks and trailers
// share the row index without collisions.
// ─────────────────────────────────────────────────────────────────────────

function fmtMoneyShort(n) {
  if (n == null || n === '') return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function rowKey(r) { return `${r.etype}:${r.id}` }

function deriveOther(cost, period) {
  const n = Number(cost)
  if (!Number.isFinite(n) || n <= 0) return null
  return period === 'weekly' ? n * 52 / 12 : n * 12 / 52
}

function LeasedEquipmentEditor({ rows, onSaved, onClose }) {
  const toast = useToast()
  const { user } = useAuth()
  const [drafts, setDrafts] = useState(() => buildInitialDrafts(rows))
  const [selected, setSelected] = useState(new Set())
  const [bulk, setBulk] = useState({ cost: '', period: 'monthly', perMile: '' })
  const [saving, setSaving] = useState(false)

  // When `rows` reloads after a successful save, reset drafts to match.
  useEffect(() => {
    setDrafts(buildInitialDrafts(rows))
    setSelected(new Set())
  }, [rows])

  function buildInitialDrafts(rows) {
    const m = {}
    for (const r of rows) {
      m[rowKey(r)] = {
        lease_cost:          r.lease_cost ?? '',
        lease_cost_period:   r.lease_cost_period || 'monthly',
        lease_cost_per_mile: r.lease_cost_per_mile ?? '',
      }
    }
    return m
  }

  function isDirty(r) {
    const d = drafts[rowKey(r)]
    if (!d) return false
    const eq = (a, b) => (a === '' || a == null) ? (b === '' || b == null) : Number(a) === Number(b)
    return !eq(d.lease_cost, r.lease_cost)
      || (d.lease_cost_period || 'monthly') !== (r.lease_cost_period || 'monthly')
      || !eq(d.lease_cost_per_mile, r.lease_cost_per_mile)
  }

  const dirtyRows = rows.filter(isDirty)
  const allSelected = rows.length > 0 && rows.every(r => selected.has(rowKey(r)))

  function setRowField(r, field, value) {
    setDrafts(prev => ({ ...prev, [rowKey(r)]: { ...prev[rowKey(r)], [field]: value } }))
  }

  function toggleRow(r) {
    setSelected(prev => {
      const next = new Set(prev)
      const k = rowKey(r)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }
  function toggleAll() {
    setSelected(prev => prev.size === rows.length ? new Set() : new Set(rows.map(rowKey)))
  }

  function applyBulk() {
    if (selected.size === 0) {
      toast.error('Select at least one row before applying.')
      return
    }
    const hasCost    = bulk.cost !== ''
    const hasPerMile = bulk.perMile !== ''
    if (!hasCost && !hasPerMile) {
      toast.error('Enter a Fixed cost and/or a Per-mile value to apply.')
      return
    }
    setDrafts(prev => {
      const next = { ...prev }
      for (const k of selected) {
        next[k] = {
          ...next[k],
          ...(hasCost ? {
            lease_cost: bulk.cost,
            lease_cost_period: bulk.period || 'monthly',
          } : {}),
          ...(hasPerMile ? { lease_cost_per_mile: bulk.perMile } : {}),
        }
      }
      return next
    })
  }

  async function saveAll() {
    if (dirtyRows.length === 0) return
    setSaving(true)
    // Partition by truck vs trailer for two batched updates.
    const truckUpdates = []
    const trailerUpdates = []
    for (const r of dirtyRows) {
      const d = drafts[rowKey(r)]
      const payload = {
        lease_cost:          d.lease_cost === '' ? null : Number(d.lease_cost),
        lease_cost_period:   d.lease_cost_period || 'monthly',
        lease_cost_per_mile: d.lease_cost_per_mile === '' ? null : Number(d.lease_cost_per_mile),
        updated_by:          user?.id || null,
      }
      ;(r.etype === 'truck' ? truckUpdates : trailerUpdates).push({ id: r.id, payload })
    }
    const tasks = [
      ...truckUpdates.map(u => supabase.from('trucks').update(u.payload).eq('id', u.id)),
      ...trailerUpdates.map(u => supabase.from('trailers').update(u.payload).eq('id', u.id)),
    ]
    const results = await Promise.all(tasks)
    setSaving(false)
    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      toast.error(`${failed.length} of ${results.length} updates failed`, failed[0].error)
    } else {
      toast.success(`${results.length} lease cost${results.length === 1 ? '' : 's'} saved`)
    }
    onSaved?.()
  }

  return (
    <div>
      <label className={S.label}>Leased Equipment ({rows.length})</label>
      <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">
        Edit a unit&apos;s Fixed cost / Period / Per-mile inline. Bulk apply pushes the same values to every selected row. The same fields are reachable from each unit&apos;s edit page — both screens read/write the one source.
      </p>

      {/* Bulk-apply form. Compact, always visible — only fires on Apply
          and only against the rows checked below. */}
      <div className="mb-2 rounded-xl border border-dashed border-gray-200 dark:border-white/10 p-3 bg-gray-50 dark:bg-white/[0.02]">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">
          Bulk apply to selected ({selected.size})
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <div>
            <label className="text-[10px] text-gray-500 dark:text-slate-400">Fixed cost</label>
            <input
              type="number" step="0.01" min="0"
              className={S.input} placeholder="0.00"
              value={bulk.cost}
              onChange={e => setBulk(b => ({ ...b, cost: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 dark:text-slate-400">Period</label>
            <Select value={bulk.period} onChange={e => setBulk(b => ({ ...b, period: e.target.value }))}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 dark:text-slate-400">Per-mile $</label>
            <input
              type="number" step="0.0001" min="0"
              className={S.input} placeholder="0.0000"
              value={bulk.perMile}
              onChange={e => setBulk(b => ({ ...b, perMile: e.target.value }))}
            />
          </div>
          <button
            type="button"
            onClick={applyBulk}
            disabled={selected.size === 0 || (bulk.cost === '' && bulk.perMile === '')}
            className={`${S.btnSave} h-[38px]`}
          >
            Apply to selected
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-white/5 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-white/[0.02] text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-500">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
              </th>
              <th className="text-left px-3 py-2 font-semibold">Unit</th>
              <th className="text-left px-3 py-2 font-semibold">Type</th>
              <th className="text-right px-3 py-2 font-semibold min-w-[110px]">Fixed cost</th>
              <th className="text-left px-3 py-2 font-semibold min-w-[110px]">Period</th>
              <th className="text-right px-3 py-2 font-semibold min-w-[110px]">Per-mile $</th>
              <th
                className="text-right px-3 py-2 font-semibold min-w-[110px]"
                title="Derived from Fixed cost ÷ Period (monthly = weekly × 52⁄12)"
              >
                Monthly equiv
              </th>
              <th
                className="text-right px-3 py-2 font-semibold min-w-[110px]"
                title="Derived from Fixed cost ÷ Period (weekly = monthly × 12⁄52)"
              >
                Weekly equiv
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {rows.map(r => {
              const k = rowKey(r)
              const d = drafts[k] || { lease_cost: '', lease_cost_period: 'monthly', lease_cost_per_mile: '' }
              const monthly = d.lease_cost_period === 'weekly'
                ? deriveOther(d.lease_cost, 'weekly')
                : (Number.isFinite(Number(d.lease_cost)) && d.lease_cost !== '' ? Number(d.lease_cost) : null)
              const weekly = d.lease_cost_period === 'monthly'
                ? deriveOther(d.lease_cost, 'monthly')
                : (Number.isFinite(Number(d.lease_cost)) && d.lease_cost !== '' ? Number(d.lease_cost) : null)
              const needsCost = (d.lease_cost === '' || d.lease_cost == null)
              const dirty = isDirty(r)
              return (
                <tr key={k} className={dirty ? 'bg-amber-50/30 dark:bg-amber-500/[0.04]' : ''}>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(k)}
                      onChange={() => toggleRow(r)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-slate-200">
                    <Link
                      to={`/fleet/${r.etype === 'truck' ? 'trucks' : 'trailers'}/${r.id}`}
                      onClick={onClose}
                      className="hover:text-orange-600 dark:hover:text-orange-400"
                      title="Open unit detail (closes this modal)"
                    >
                      {r.unit_number || r.vin?.slice(-6) || r.id.slice(0, 8)}
                    </Link>
                    {needsCost && (
                      <span
                        className="ml-2 inline-block px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wide bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20"
                        title="No fixed cost entered yet — appears in the Needs cost worklist on Fleet Cost."
                      >
                        needs cost
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400 uppercase">{r.etype}</td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" step="0.01" min="0"
                      className={`${S.input} text-right`}
                      placeholder="0.00"
                      value={d.lease_cost}
                      onChange={e => setRowField(r, 'lease_cost', e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Select
                      value={d.lease_cost_period}
                      onChange={e => setRowField(r, 'lease_cost_period', e.target.value)}
                    >
                      <option value="monthly">Monthly</option>
                      <option value="weekly">Weekly</option>
                    </Select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" step="0.0001" min="0"
                      className={`${S.input} text-right`}
                      placeholder="0.0000"
                      value={d.lease_cost_per_mile}
                      onChange={e => setRowField(r, 'lease_cost_per_mile', e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-slate-300">
                    {fmtMoneyShort(monthly)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-500 dark:text-slate-400">
                    {fmtMoneyShort(weekly)}
                  </td>
                </tr>
              )
            })}
            {(() => {
              // Totals across the live drafts. Per-mile is rate not money so
              // we don't sum it — show count of rows carrying a rate.
              let mTot = 0, wTot = 0, withPerMile = 0
              for (const r of rows) {
                const d = drafts[rowKey(r)] || {}
                const n = Number(d.lease_cost)
                if (Number.isFinite(n) && n > 0) {
                  const m = d.lease_cost_period === 'weekly' ? n * 52 / 12 : n
                  const w = d.lease_cost_period === 'weekly' ? n : n * 12 / 52
                  mTot += m; wTot += w
                }
                if (d.lease_cost_per_mile !== '' && d.lease_cost_per_mile != null) withPerMile++
              }
              return (
                <tr className="bg-gray-50 dark:bg-white/[0.02]">
                  <td className="px-3 py-1.5" colSpan={5}>
                    <span className="font-semibold text-gray-700 dark:text-slate-300">Totals</span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-[10px] text-gray-500 dark:text-slate-500">
                    {withPerMile} with rate
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-gray-900 dark:text-slate-200">
                    {fmtMoneyShort(mTot)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-gray-600 dark:text-slate-400">
                    {fmtMoneyShort(wTot)}
                  </td>
                </tr>
              )
            })()}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-2">
        <p className="text-[11px] text-gray-500 dark:text-slate-500">
          {dirtyRows.length === 0
            ? <>No pending changes</>
            : <><span className="font-semibold text-gray-700 dark:text-slate-300">{dirtyRows.length}</span> row{dirtyRows.length === 1 ? '' : 's'} with pending changes</>}
        </p>
        <button
          type="button"
          onClick={saveAll}
          disabled={saving || dirtyRows.length === 0}
          className={S.btnSave}
        >
          {saving ? 'Saving…' : `Save ${dirtyRows.length || ''} change${dirtyRows.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {/* Totals helper text — per-mile dollar impact is intentionally
          not summed: the rate × miles total lands once Loads ingest
          supplies per-unit mileage. */}
      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-2 leading-tight">
        Per-mile $ is the rate; dollar impact (rate × miles) shows up on Fleet Cost once Loads supply mileage.
      </p>
    </div>
  )
}
