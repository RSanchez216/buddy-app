// Vector rendering of the on-page Amazon Team block into the Scorecard PDF —
// title + ONE DESK badge, explainer, four stat cards, the "who books well"
// bookers table with per-booker STRONG/MID/WEAK badges, and the retention line.
// Mirrors the on-screen AmazonCard and reuses bookerTier so the ratings are
// identical on both surfaces. jsPDF primitives only (selectable text).
import { money, int, rpm, bookerTier } from './dispatcherData'

const C = {
  ink: [15, 23, 42], muted: [100, 116, 139], border: [226, 232, 240],
  indigo: [79, 70, 229], indigoBg: [238, 242, 255], orange: [234, 88, 12], blueName: [29, 78, 216],
  strong: { fg: [5, 150, 105], bg: [236, 253, 245] },
  mid: { fg: [180, 83, 9], bg: [254, 243, 199] },
  weak: { fg: [220, 38, 38], bg: [254, 242, 242] },
}
const setFill = (d, c) => d.setFillColor(c[0], c[1], c[2])
const setText = (d, c) => d.setTextColor(c[0], c[1], c[2])
const setDraw = (d, c) => d.setDrawColor(c[0], c[1], c[2])

export function drawAmazonSectionPdf(doc, autoTable, { amazon, bookers, inProgress, startY, margin }) {
  const M = margin
  const pw = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pw - 2 * M
  let y = startY
  if (y > pageH - 150) { doc.addPage(); y = 40 } // keep the section off the page edge

  // Title + ONE DESK badge
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setText(doc, C.ink)
  doc.text('Amazon Team', M, y)
  const tw = doc.getTextWidth('Amazon Team')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
  const badge = 'ONE DESK', bw = doc.getTextWidth(badge) + 8
  setFill(doc, C.indigoBg); doc.roundedRect(M + tw + 8, y - 7.5, bw, 11, 3, 3, 'F')
  setText(doc, C.indigo); doc.text(badge, M + tw + 12, y)

  if (!bookers || bookers.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText(doc, C.muted)
    doc.text('No Amazon-team freight this period.', M, y + 16)
    return y + 24
  }

  // Explainer
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setText(doc, C.muted)
  const exLines = doc.splitTextToSize('Judged as one desk because bookings rotate among the team — no single member owns a load, so gross and retention are pooled.', contentW)
  doc.text(exLines, M, y + 14)
  y = y + 14 + exLines.length * 10 + 8

  // Four stat cards (from the aggregate row) — TEAM GROSS carries an indigo accent.
  const gap = 10, cardW = (contentW - 3 * gap) / 4, cardH = 48
  const cards = [
    { label: 'TEAM GROSS', value: money(amazon?.gross), sub: inProgress ? 'to date' : null, accent: true },
    { label: 'RPM', value: rpm(amazon?.rpm) },
    { label: 'LOADS', value: int(amazon?.loads) },
    { label: 'DEPARTED', value: int(amazon?.turnover), sub: 'drivers left' },
  ]
  cards.forEach((c, i) => {
    const cx = M + i * (cardW + gap)
    setFill(doc, [255, 255, 255]); setDraw(doc, C.border); doc.setLineWidth(1)
    doc.roundedRect(cx, y, cardW, cardH, 9, 9, 'FD')
    if (c.accent) { setFill(doc, C.indigo); doc.roundedRect(cx, y + 6, 3, cardH - 12, 1.5, 1.5, 'F') }
    const tx = cx + 11
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(doc, C.muted); doc.text(c.label, tx, y + 15)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); setText(doc, C.ink); doc.text(String(c.value), tx, y + 34)
    if (c.sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(doc, C.muted); doc.text(c.sub, tx, y + 44) }
  })
  y += cardH + 16

  // WHO BOOKS WELL
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setText(doc, C.muted)
  doc.text('WHO BOOKS WELL', M, y)
  y += 4

  const teamRpm = Number(amazon?.rpm || 0)
  const sorted = [...bookers].sort((a, b) => Number(b.gross) - Number(a.gross)).map(b => ({ ...b, tier: bookerTier(b, teamRpm) }))
  autoTable(doc, {
    startY: y + 4,
    head: [['Booker', 'Gross', 'Loads', 'RPM', 'Drivers']],
    body: sorted.map(b => [b.dispatcher_name, money(b.gross), int(b.loads), rpm(b.rpm), int(b.drivers)]),
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: C.orange },
    columnStyles: { 0: { textColor: C.blueName, cellWidth: 280 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: M, right: M },
    // Draw the rating pill right after the (single-line) booker name.
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 0) return
      const b = sorted[data.row.index]
      const t = b && C[b.tier]
      if (!t) return
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
      const nameW = doc.getTextWidth(b.dispatcher_name)
      const label = b.tier.toUpperCase()
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6)
      const lw = doc.getTextWidth(label) + 7
      let bx = data.cell.x + 3 + nameW + 6
      const maxX = data.cell.x + data.cell.width - 2 - lw
      if (bx > maxX) bx = maxX
      const by = data.cell.y + (data.cell.height - 9) / 2
      setFill(doc, t.bg); doc.roundedRect(bx, by, lw, 9, 2.5, 2.5, 'F')
      setText(doc, t.fg); doc.text(label, bx + 3.5, by + 6.2)
    },
  })
  y = doc.lastAutoTable.finalY + 12

  // Retention
  const dep = Number(amazon?.turnover)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setText(doc, C.muted)
  doc.text(`Retention: ${int(amazon?.turnover)} driver${dep === 1 ? '' : 's'} left the team this period.`, M, y)
  return y + 12
}
