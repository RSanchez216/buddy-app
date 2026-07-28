// Vector (selectable-text) jsPDF reports for Usage & Activity — same recipe as
// the dispatcher scorecard PDF (no html2canvas): everything is drawn with
// doc.text / roundedRect / lines, and the sessions table uses jspdf-autotable.
//
// Two entry points:
//   downloadUserUsagePdf(summary)  — one user (Part C)
//   downloadTeamUsagePdf(all)      — cover roster + one section per user (Part D)
// Both share drawUserSection() so the single-user and per-user layouts match.

import {
  fmtActive, fmtTime, fmtDayShort, fmtDayLong, fmtRelative, daysInRange, addDaysYmd,
} from './usageFormat'

// RGB tuples (jsPDF wants numeric channels). Note: jsPDF's standard Helvetica is
// WinAnsi-encoded, so we avoid non-WinAnsi glyphs (→) and use "->" in text.
const C = {
  ink: [15, 23, 42], muted: [100, 116, 139], line: [226, 232, 240],
  orange: [249, 115, 22], orangeSoft: [253, 215, 170], cardBg: [248, 250, 252],
  green: [5, 150, 105], greenBg: [236, 253, 245],
  indigo: [79, 70, 229], amber: [180, 83, 9], white: [255, 255, 255],
}
const setFill = (d, c) => d.setFillColor(c[0], c[1], c[2])
const setText = (d, c) => d.setTextColor(c[0], c[1], c[2])
const setDraw = (d, c) => d.setDrawColor(c[0], c[1], c[2])

const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '')
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
const compact = (ymd) => String(ymd || '').replace(/-/g, '')

// Shrink the font (leaving it active) until str fits maxW.
function fitFont(doc, str, maxW, size, min = 6) {
  let s = size
  doc.setFontSize(s)
  while (doc.getTextWidth(str) > maxW && s > min) { s -= 0.5; doc.setFontSize(s) }
  return str
}
// Truncate with an ellipsis to fit maxW at a fixed size.
function clip(doc, str, maxW, size) {
  doc.setFontSize(size)
  str = String(str ?? '')
  if (doc.getTextWidth(str) <= maxW) return str
  let s = str
  while (s.length > 1 && doc.getTextWidth(s + '…') > maxW) s = s.slice(0, -1)
  return s + '…'
}
function enumerateDays(start, end) {
  if (!start || !end) return []
  const out = []
  let cur = start, guard = 0
  while (cur <= end && guard < 366) { out.push(cur); cur = addDaysYmd(cur, 1); guard++ }
  return out
}
function fmtGenerated(ts) {
  const d = ts ? new Date(ts) : new Date()
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(d) + ' CT'
  } catch { return '' }
}

// Vertical page-break guard: if `need` pts won't fit, start a new page.
function ensureSpace(doc, y, need, M) {
  const pageH = doc.internal.pageSize.getHeight()
  if (y + need > pageH - M) { doc.addPage(); return M + 6 }
  return y
}

// ── Blocks ────────────────────────────────────────────────────────────────
function drawUserHeader(doc, summary, x, y, w) {
  const u = summary.user || {}
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); setText(doc, C.ink)
  doc.text(clip(doc, u.name || u.email || 'User', w, 14), x, y)
  y += 14
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText(doc, C.muted)
  const meta = [u.email, cap(u.role), cap(u.status)].filter(Boolean).join('   ·   ')
  doc.text(clip(doc, meta, w, 9), x, y)
  y += 11
  const r = summary.range || {}
  doc.setFontSize(8)
  doc.text(`${fmtDayShort(r.start)} - ${fmtDayShort(r.end)}`, x, y)
  return y + 4
}

function drawStatCards(doc, summary, x, y, w) {
  const cards = [
    { label: 'ACTIVE TIME', value: fmtActive(summary.active_seconds), sub: `${fmtActive(summary.open_seconds)} on page`, hero: true },
    { label: 'SESSIONS', value: String(summary.sessions ?? 0) },
    { label: 'AVG SESSION', value: fmtActive(summary.avg_session_seconds) },
    { label: 'ACTIVE DAYS', value: `${summary.active_days ?? 0}/${daysInRange(summary.range?.start, summary.range?.end)}` },
    { label: 'LAST ACTIVE', value: fmtRelative(summary.last_active) },
  ]
  const gap = 8, n = cards.length
  const cw = (w - (n - 1) * gap) / n
  const ch = 46
  cards.forEach((c, i) => {
    const cx = x + i * (cw + gap)
    if (c.hero) { setFill(doc, C.greenBg); setDraw(doc, C.green); doc.setLineWidth(1) }
    else { setFill(doc, C.white); setDraw(doc, C.line); doc.setLineWidth(0.8) }
    doc.roundedRect(cx, y, cw, ch, 6, 6, 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); setText(doc, c.hero ? C.green : C.muted)
    doc.text(c.label, cx + 8, y + 15)
    doc.setFont('helvetica', 'bold'); setText(doc, c.hero ? C.green : C.ink)
    doc.text(fitFont(doc, String(c.value), cw - 14, c.hero ? 15 : 13, 8), cx + 8, c.sub ? y + 30 : y + 34)
    if (c.sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); setText(doc, c.hero ? C.green : C.muted)
      doc.text(clip(doc, `- ${c.sub}`, cw - 14, 6.5), cx + 8, y + 40)
    }
  })
  return y + ch
}

function drawTimeByPage(doc, rows, x, y, w) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setText(doc, C.ink)
  doc.text('Time by page', x, y)
  // Bar = on-page (relative to top page's on-page); dark fill = active portion.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setText(doc, C.muted)
  doc.text('bar = on page  |  fill = active', x + w, y, { align: 'right' })
  y += 10
  const topOpen = Math.max(1, ...rows.map(r => Number(r.open_seconds ?? r.seconds) || 0))
  const labelW = 140, valueW = 88, gap = 8
  const barX = x + labelW + gap
  const barW = w - labelW - valueW - 2 * gap
  const rowH = 14
  for (const r of rows.slice(0, 10)) {
    const active = Number(r.seconds) || 0
    const open = Number(r.open_seconds ?? r.seconds) || 0
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(doc, C.ink)
    doc.text(clip(doc, r.label || '-', labelW, 8), x, y + 8)
    setFill(doc, C.cardBg); doc.roundedRect(barX, y + 2, barW, 7, 3, 3, 'F')
    const ow = Math.max(2, Math.round((open / topOpen) * barW))
    setFill(doc, C.orangeSoft); doc.roundedRect(barX, y + 2, ow, 7, 3, 3, 'F')
    const aw = open > 0 ? Math.max(1, Math.round((active / open) * ow)) : 0
    if (aw > 0) { setFill(doc, C.orange); doc.roundedRect(barX, y + 2, aw, 7, 3, 3, 'F') }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(doc, C.muted)
    doc.text(`${fmtActive(active)} / ${fmtActive(open)}`, x + w, y + 8, { align: 'right' })
    y += rowH
  }
  return y + 2
}

function drawDailyChart(doc, byDay, range, x, y, w) {
  const days = enumerateDays(range?.start, range?.end)
  if (!days.length) return y
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setText(doc, C.ink)
  doc.text('Daily active time', x, y); y += 8
  const map = new Map((byDay || []).map(d => [d.day, Number(d.seconds) || 0]))
  const data = days.map(d => ({ day: d, seconds: map.get(d) || 0 }))
  const max = Math.max(1, ...data.map(d => d.seconds))
  const chartH = 44
  const baseY = y + chartH
  const n = data.length
  const gap = n > 40 ? 1 : 2
  const bw = Math.max(2, (w - (n - 1) * gap) / n)
  data.forEach((d, i) => {
    if (d.seconds <= 0) return
    const bx = x + i * (bw + gap)
    const bh = Math.max(2, (d.seconds / max) * chartH)
    setFill(doc, C.orange); doc.roundedRect(bx, baseY - bh, bw, bh, 1, 1, 'F')
  })
  setDraw(doc, C.line); doc.setLineWidth(0.5); doc.line(x, baseY, x + w, baseY)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); setText(doc, C.muted)
  doc.text(fmtDayShort(range.start), x, baseY + 8)
  doc.text(fmtDayShort(range.end), x + w, baseY + 8, { align: 'right' })
  return baseY + 12
}

function drawSessions(doc, autoTable, rows, x, y, w) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setText(doc, C.ink)
  doc.text('Sessions', x, y)
  const pw = doc.internal.pageSize.getWidth()
  autoTable(doc, {
    startY: y + 6,
    head: [['Date', 'Signed in', 'Active', 'On page', 'Pages', 'Flow', 'Ended']],
    body: rows.map(s => [
      fmtDayLong(s.date || s.start),
      fmtTime(s.start),
      fmtActive(s.active_seconds),
      fmtActive(s.open_seconds),
      String(s.pages ?? '-'),
      `${s.first_page || '-'} -> ${s.last_page || '-'}`,
      s.ended === 'live' ? 'live now' : s.ended === 'signout' ? 'signed out' : s.ended === 'idle' ? 'idle 30m' : (s.ended || '-'),
    ]),
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: C.orange, textColor: C.white },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { cellWidth: 130 } },
    margin: { left: x, right: pw - (x + w) },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 6) {
        const s = rows[d.row.index]
        const col = s?.ended === 'live' ? C.indigo : s?.ended === 'signout' ? C.green : s?.ended === 'idle' ? C.amber : C.muted
        d.cell.styles.textColor = col
        d.cell.styles.fontStyle = 'bold'
      }
    },
  })
  return doc.lastAutoTable.finalY
}

// One user's full report at (M, y). Returns the bottom Y. Handles its own
// page breaks; the sessions autoTable paginates itself.
function drawUserSection(doc, autoTable, summary, M, y, w) {
  let cy = drawUserHeader(doc, summary, M, y, w) + 10
  cy = drawStatCards(doc, summary, M, cy, w) + 16

  const empty = !summary.active_seconds && (summary.session_list || []).length === 0
  if (empty) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); setText(doc, C.muted)
    doc.text('No activity recorded in this range.', M, cy)
    return cy + 12
  }

  const byPage = summary.by_page || []
  if (byPage.length) {
    cy = ensureSpace(doc, cy, 24 + Math.min(byPage.length, 10) * 14, M)
    cy = drawTimeByPage(doc, byPage, M, cy, w) + 14
  }
  if (summary.range?.start) {
    cy = ensureSpace(doc, cy, 80, M)
    cy = drawDailyChart(doc, summary.by_day || [], summary.range, M, cy, w) + 14
  }
  const sess = summary.session_list || []
  if (sess.length) {
    cy = ensureSpace(doc, cy, 64, M)
    cy = drawSessions(doc, autoTable, sess, M, cy, w)
  }
  return cy
}

// Big title band on the current page top.
function drawDocTitle(doc, title, range, generatedAt, M) {
  const pw = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); setText(doc, C.ink)
  doc.text(title, M, 46)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setText(doc, C.muted)
  const rangeStr = range ? `${fmtDayShort(range.start)} - ${fmtDayShort(range.end)}` : ''
  const parts = [rangeStr, `Generated ${fmtGenerated(generatedAt)}`].filter(Boolean).join('     ·     ')
  doc.text(parts, M, 66)
  setDraw(doc, C.line); doc.setLineWidth(0.5); doc.line(M, 74, pw - M, 74)
}

// Page "n / total" footer stamped on every page after the doc is built.
function stampPageNumbers(doc, M) {
  const n = doc.internal.getNumberOfPages()
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(doc, C.muted)
    doc.text(`Page ${i} / ${n}`, pw - M, ph - 20, { align: 'right' })
  }
}

async function loadPdf() {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  return { jsPDF, autoTable: autoTableMod.default }
}

// ── Part C — single user ────────────────────────────────────────────────
export async function downloadUserUsagePdf(summary) {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const M = 40
  const w = doc.internal.pageSize.getWidth() - 2 * M
  drawDocTitle(doc, 'Usage & Activity', summary.range, null, M)
  drawUserSection(doc, autoTable, summary, M, 96, w)
  stampPageNumbers(doc, M)
  const u = summary.user || {}
  doc.save(`Usage - ${safe(u.name || u.email || 'user')} - ${compact(summary.range?.start)}-${compact(summary.range?.end)}.pdf`)
}

// ── Part D — all users, one combined PDF ─────────────────────────────────
export async function downloadTeamUsagePdf(all) {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const M = 40
  const w = doc.internal.pageSize.getWidth() - 2 * M
  const users = all.users || []

  // Cover / roster summary — whole team visible up front.
  drawDocTitle(doc, 'Team Usage & Activity', all.range, all.generated_at, M)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setText(doc, C.ink)
  doc.text(`Team roster · ${users.length} user${users.length === 1 ? '' : 's'}`, M, 96)
  autoTable(doc, {
    startY: 104,
    head: [['Name', 'Role', 'Active time', 'On page', 'Sessions', 'Active days', 'Last active']],
    body: users.map(s => {
      const u = s.user || {}
      return [
        u.name || u.email || '-',
        cap(u.role),
        fmtActive(s.active_seconds),
        fmtActive(s.open_seconds),
        String(s.sessions ?? 0),
        `${s.active_days ?? 0}/${daysInRange(s.range?.start, s.range?.end)}`,
        fmtRelative(s.last_active),
      ]
    }),
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: C.orange, textColor: C.white },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { left: M, right: M },
  })

  // One detailed section per user, page-broken (order as returned by the RPC).
  for (const s of users) {
    doc.addPage()
    drawUserSection(doc, autoTable, s, M, M + 12, w)
  }

  stampPageNumbers(doc, M)
  doc.save(`Team Usage - ${compact(all.range?.start)}-${compact(all.range?.end)}.pdf`)
}
