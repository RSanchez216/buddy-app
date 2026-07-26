// Vector rendering of the on-page Dispatcher Scorecard interpretation card into
// a jsPDF doc — drawn with primitives (no rasterization) so text stays
// selectable and crisp. Mirrors ScorecardInterpretation.jsx clause-for-clause
// and uses the same money/int formatters, so the PDF and screen reconcile
// digit-for-digit for the same period. Keep the two in sync.
import { money, int } from './dispatcherData'

const C = {
  frame: [249, 115, 22],      // #F97316
  accentDark: [234, 88, 12],  // #EA580C
  accentText: [154, 52, 18],  // #9A3412
  pillBg: [255, 237, 213],    // #FFEDD5
  cardBg: [248, 250, 252],    // #F8FAFC
  red: [220, 38, 38],         // #DC2626
  green: [5, 150, 105],       // #059669
  amber: [180, 83, 9],        // #B45309
  ink: [15, 23, 42],          // #0F172A
  muted: [100, 116, 139],     // #64748B
  disc: [148, 163, 184],      // #94A3B8
}
const GRAIN_WORD = { month: 'month', quarter: 'quarter', half: 'half', year: 'year' }
const pct1 = (x) => `${Math.abs(Number(x)).toFixed(1)}%`
const timesX = (x) => `${Number(x).toFixed(1)}×`
const setFill = (pdf, c) => pdf.setFillColor(c[0], c[1], c[2])
const setText = (pdf, c) => pdf.setTextColor(c[0], c[1], c[2])
const setDraw = (pdf, c) => pdf.setDrawColor(c[0], c[1], c[2])

// Verdict as coloured runs — same clauses/conditions as the screen <Verdict>.
function verdictSegs(d) {
  const o = d.overall || {}, eff = d.efficiency || {}, az = d.amazon || {}
  const grainWord = GRAIN_WORD[d.grain] || 'period'
  const segs = []
  const ink = (t) => segs.push({ text: t, rgb: C.ink })
  const delta = (x) => segs.push({ text: `${Number(x) < 0 ? 'down' : 'up'} ${pct1(x)}`, rgb: Number(x) < 0 ? C.red : C.green, bold: true })
  ink(`${d.period_label}${d.kind ? ` ${d.kind}` : ''}: ${money(o.gross)} across ${int(o.desks)} desks and ${int(o.loads)} loads. `)
  if (eff.spread_x != null) ink(`Output per driver swings ${timesX(eff.spread_x)} — ${money(eff.top_pdm)} a driver-month at the top, ${money(eff.bottom_pdm)} at the bottom. `)
  if (d.gross_delta_pct != null) { ink('Revenue is '); delta(d.gross_delta_pct); ink(` vs the same point last ${grainWord}. `) }
  if (Number(o.turnover) > 0) ink(`${int(o.turnover)} drivers changed desks. `)
  if (Number(az.gross) > 0) {
    if (az.delta_pct != null) { ink(`Amazon desks did ${money(az.gross)}, `); delta(az.delta_pct); ink('.') }
    else ink(`Amazon desks did ${money(az.gross)} across ${int(az.drivers)} drivers.`)
  }
  return segs
}

// Three callouts — same adaptive slotting as the screen card.
function buildCallouts(d) {
  const out = []
  if (d.top_desk) {
    out.push({ label: 'TOP DESK', name: d.top_desk.name, reason: 'Most productive',
      metric: [{ text: `${money(d.top_desk.per_driver_month)}/driver-mo · ${money(d.top_desk.gross)}`, rgb: C.green }] })
  }
  if (d.decliner) {
    out.push({ label: 'NEEDS ATTENTION', name: d.decliner.name, reason: 'Steepest drop, same-point',
      metric: [{ text: `down ${pct1(d.decliner.delta_pct)}`, rgb: C.red }, { text: ` · ${money(d.decliner.prev_gross)} → ${money(d.decliner.gross)}`, rgb: C.ink }] })
  } else if (d.amazon && Number(d.amazon.drivers) >= 3) {
    const m = [{ text: `${money(d.amazon.gross)} · ${int(d.amazon.drivers)} drivers`, rgb: C.ink }]
    if (d.amazon.delta_pct != null) m.push({ text: ` · ${Number(d.amazon.delta_pct) < 0 ? 'down' : 'up'} ${pct1(d.amazon.delta_pct)}`, rgb: Number(d.amazon.delta_pct) < 0 ? C.red : C.green })
    out.push({ label: 'AMAZON', name: money(d.amazon.gross), reason: 'Amazon freight', metric: m })
  } else if (d.gainer) {
    out.push({ label: 'BIGGEST GAINER', name: d.gainer.name, reason: '', metric: [{ text: `up ${pct1(d.gainer.delta_pct)}`, rgb: C.green }] })
  }
  if (d.retention) {
    out.push({ label: 'RETENTION WATCH', name: d.retention.name, reason: 'Highest turnover',
      metric: [{ text: `${int(d.retention.turnover)} drivers left`, rgb: C.amber }] })
  }
  return out
}

// Fit text to width by shrinking (to min), then ellipsize. Sets the font size.
function fit(pdf, str, maxW, base, min) {
  let s = base
  pdf.setFontSize(s)
  while (pdf.getTextWidth(str) > maxW && s > min) { s -= 0.5; pdf.setFontSize(s) }
  if (pdf.getTextWidth(str) > maxW) {
    let t = str
    while (t.length > 1 && pdf.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
    return t + '…'
  }
  return str
}
// Draw coloured segments flowing/wrapping to maxW. Returns baseline of last line.
function drawSegs(pdf, segs, x, y, maxW, lineH, size) {
  pdf.setFontSize(size)
  let cx = x, cy = y
  for (const seg of segs) {
    pdf.setFont('helvetica', seg.bold ? 'bold' : 'normal')
    for (const tok of seg.text.split(/(\s+)/)) {
      if (!tok) continue
      if (/^\s+$/.test(tok)) { if (cx > x) cx += pdf.getTextWidth(tok); continue }
      const w = pdf.getTextWidth(tok)
      if (cx + w > x + maxW + 0.5) { cx = x; cy += lineH }
      setText(pdf, seg.rgb); pdf.text(tok, cx, cy); cx += w
    }
  }
  pdf.setFont('helvetica', 'normal')
  return cy
}

// Draw the block at (x, y) width w. Returns the y of its bottom edge.
export function drawScorecardInterpPdf(pdf, interp, x, y, w) {
  const pad = 16
  const cx0 = x + pad
  const cw = w - 2 * pad
  const callouts = buildCallouts(interp)
  const gap = 10
  const nBox = Math.max(callouts.length, 1)
  const boxW = (cw - (nBox - 1) * gap) / nBox
  const boxPad = 8
  const boxIW = boxW - 2 * boxPad
  const DISC = `Ranks on productivity (gross per driver-month), momentum, and turnover — not raw revenue, so lean desks aren't buried by big ones. Comparisons are same-point${interp.kind ? ` (${interp.kind} vs the same point last period)` : ''}.`

  // ── measure ────────────────────────────────────────────────────────────────
  const segs = verdictSegs(interp)
  const vLineH = 12
  // Estimate verdict line count from the concatenated plain text.
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
  const vLineCount = pdf.splitTextToSize(segs.map(s => s.text).join(''), cw).length
  const verdictH = vLineCount * vLineH

  const nameLinesFor = (c) => { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); return pdf.splitTextToSize(c.name, boxIW).slice(0, 2) }
  const boxNameLines = callouts.map(nameLinesFor)
  const boxH = boxPad + 11 + boxNameLines.reduce((mx, l) => Math.max(mx, l.length), 1) * 12 + 12 + 11 + boxPad

  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5)
  const discLines = pdf.splitTextToSize(DISC, cw)
  const discH = discLines.length * 9

  const headerH = 16, gap1 = 8, gap2 = 12, gap3 = 10
  const totalH = pad + headerH + gap1 + verdictH + gap2 + (callouts.length ? boxH + gap3 : 0) + discH + pad

  // ── frame ──────────────────────────────────────────────────────────────────
  setDraw(pdf, C.frame); pdf.setLineWidth(2)
  pdf.roundedRect(x, y, w, totalH, 12, 12, 'S')

  // ── header ─────────────────────────────────────────────────────────────────
  const hy = y + pad + 8
  setFill(pdf, C.frame); pdf.circle(cx0 + 3, hy - 3, 3, 'F')
  let hx = cx0 + 11
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); setText(pdf, C.accentText)
  pdf.text('INTERPRETATION', hx, hy); hx += pdf.getTextWidth('INTERPRETATION') + 6
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); setText(pdf, C.muted)
  const per = `· ${interp.period_label || ''}`
  pdf.text(per, hx, hy); hx += pdf.getTextWidth(per) + 8
  if (interp.partial && interp.kind) {
    pdf.setFontSize(7.5)
    const pw = pdf.getTextWidth(interp.kind) + 10
    setFill(pdf, C.pillBg); pdf.roundedRect(hx, hy - 8, pw, 12, 6, 6, 'F')
    setText(pdf, C.accentText); pdf.text(interp.kind, hx + 5, hy)
  }

  // ── verdict ────────────────────────────────────────────────────────────────
  drawSegs(pdf, segs, cx0, y + pad + headerH + gap1 + 9, cw, vLineH, 9)

  // ── callout boxes ────────────────────────────────────────────────────────────
  const boxTop = y + pad + headerH + gap1 + verdictH + gap2
  callouts.forEach((c, i) => {
    const bx = cx0 + i * (boxW + gap)
    setFill(pdf, C.cardBg); pdf.roundedRect(bx, boxTop, boxW, boxH, 9, 9, 'F')
    const ix = bx + boxPad
    let by = boxTop + boxPad + 8
    // label
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); setText(pdf, C.muted)
    pdf.text(c.label, ix, by); by += 11
    // name (accent-dark, up to 2 lines)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); setText(pdf, C.accentDark)
    boxNameLines[i].forEach((ln) => { pdf.text(ln, ix, by); by += 12 })
    // metric runs on one line (fit the whole line's width by shrinking if needed)
    const metricStr = c.metric.map(m => m.text).join('')
    let msize = 9.5
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(msize)
    while (pdf.getTextWidth(metricStr) > boxIW && msize > 7) { msize -= 0.5; pdf.setFontSize(msize) }
    let mx = ix
    for (const run of c.metric) { setText(pdf, run.rgb); pdf.text(run.text, mx, by); mx += pdf.getTextWidth(run.text) }
    by += 11
    // reason
    if (c.reason) {
      pdf.setFont('helvetica', 'normal'); setText(pdf, C.muted)
      pdf.text(fit(pdf, c.reason, boxIW, 8, 6.5), ix, by)
    }
  })

  // ── disclaimer ───────────────────────────────────────────────────────────────
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); setText(pdf, C.disc)
  pdf.text(discLines, cx0, boxTop + (callouts.length ? boxH + gap3 : 0) + 8)

  pdf.setLineWidth(0.2)
  return y + totalH
}
