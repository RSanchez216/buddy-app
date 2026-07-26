// Vector rendering of the on-page interpretation card into a jsPDF doc — drawn
// with primitives (no rasterization) so the text stays selectable and crisp.
// Mirrors the on-screen card; wording comes from milesInterpText so the two
// read identically.
import { verdictText, loadsLabel, pctS, trendPhraseText, trendWordText } from './milesInterpText'

const C = {
  frame: [249, 115, 22],      // #F97316
  accentDark: [234, 88, 12],  // #EA580C
  accentText: [154, 52, 18],  // #9A3412
  pillBg: [255, 237, 213],    // #FFEDD5
  cardBg: [248, 250, 252],    // #F8FAFC
  red: [220, 38, 38],         // #DC2626
  green: [5, 150, 105],       // #059669
  ink: [15, 23, 42],          // #0F172A
  muted: [100, 116, 139],     // #64748B
  disc: [148, 163, 184],      // #94A3B8
}
const fill = (pdf, c) => pdf.setFillColor(c[0], c[1], c[2])
const text = (pdf, c) => pdf.setTextColor(c[0], c[1], c[2])
const draw = (pdf, c) => pdf.setDrawColor(c[0], c[1], c[2])

function monthYear(ymd) {
  const [y, m] = String(ymd || '').split('-').map(Number)
  if (!y || !m) return ''
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
// The trend phrase to colour inline (week/month only, and only vs a prior).
function trendSeg(interp) {
  if (!(interp.prev && interp.prev.dh != null)) return null
  if (interp.grain === 'week') return { text: trendPhraseText(interp.dh_trend, interp.dh_delta), dir: interp.dh_trend }
  if (interp.grain === 'month') return { text: trendWordText(interp.dh_trend), dir: interp.dh_trend }
  return null
}
function reasonFor(key, dim) {
  if (!dim.flag) return ''
  const base = loadsLabel(dim.flag.loads)
  if (key === 'region') return `${base}${dim.top && dim.flag.name === dim.top.name ? ' — highest-impact target' : ''}`
  if (key === 'dispatcher') return `${base} running hot`
  return `${base} — watch`
}
function contextFor(dim) {
  return dim.top ? `${dim.top.name} carries the volume — ${loadsLabel(dim.top.loads)} at ${pctS(dim.top.dh)}` : ''
}
// Shrink font to fit width (down to min), then ellipsize if still too wide.
function fitText(pdf, str, maxW, base, min) {
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

// Flow the verdict with the trend phrase drawn in its trend colour, wrapping to
// maxW. Returns the baseline of the last line.
function drawVerdict(pdf, interp, x, y, maxW, lineH) {
  const full = verdictText(interp)
  const seg = trendSeg(interp)
  let parts = [{ t: full, rgb: C.ink }]
  if (seg && full.includes(seg.text)) {
    const i = full.indexOf(seg.text)
    const rgb = seg.dir === 'up' ? C.red : seg.dir === 'down' ? C.green : C.ink
    parts = [
      { t: full.slice(0, i), rgb: C.ink },
      { t: seg.text, rgb },
      { t: full.slice(i + seg.text.length), rgb: C.ink },
    ]
  }
  const words = []
  for (const p of parts) for (const tok of p.t.split(/(\s+)/)) if (tok.length) words.push({ tok, rgb: p.rgb })
  let cx = x, cy = y
  for (const wd of words) {
    if (/^\s+$/.test(wd.tok)) { if (cx > x) cx += pdf.getTextWidth(wd.tok); continue }
    const ww = pdf.getTextWidth(wd.tok)
    if (cx + ww > x + maxW + 0.5) { cx = x; cy += lineH }
    text(pdf, wd.rgb); pdf.text(wd.tok, cx, cy); cx += ww
  }
  return cy
}

// Draw the whole block at (x, y) with width w. Returns the y of its bottom edge.
export function drawInterpretationPdf(pdf, interp, x, y, w) {
  const pad = 16
  const cx0 = x + pad
  const cw = w - 2 * pad
  const dims = [['region', interp.region || {}], ['dispatcher', interp.dispatcher || {}], ['driver', interp.driver || {}]]
  const gap = 10
  const boxW = (cw - 2 * gap) / 3
  const boxPad = 8
  const boxIW = boxW - 2 * boxPad
  const DISC = 'Reads deadhead %, RPM, and loaded-mile volume — never profit (gross here is freight volume, ~56% pass-through).'

  // ── measure ────────────────────────────────────────────────────────────────
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
  const vLines = pdf.splitTextToSize(verdictText(interp), cw)
  const vLineH = 12
  const verdictH = vLines.length * vLineH

  const boxHeights = dims.map(([key, dim]) => {
    let h = boxPad + 8 + 12 // top pad + label
    if (dim.flag) {
      h += 13
      pdf.setFontSize(8)
      const reason = reasonFor(key, dim)
      if (reason) h += pdf.splitTextToSize(reason, boxIW).length * 10
    } else {
      h += 14
    }
    h += 13 // bright
    if (key === 'region' && dim.top) {
      pdf.setFontSize(7.5)
      h += pdf.splitTextToSize(contextFor(dim), boxIW).length * 9
    }
    return h + boxPad + 4
  })
  const boxH = Math.max(...boxHeights)

  pdf.setFontSize(7.5)
  const discLines = pdf.splitTextToSize(DISC, cw)
  const discH = discLines.length * 9

  const headerH = 16, gap1 = 8, gap2 = 12, gap3 = 10
  const totalH = pad + headerH + gap1 + verdictH + gap2 + boxH + gap3 + discH + pad

  // ── frame ────────────────────────────────────────────────────────────────
  draw(pdf, C.frame); pdf.setLineWidth(2)
  pdf.roundedRect(x, y, w, totalH, 12, 12, 'S')

  // ── header ───────────────────────────────────────────────────────────────
  let hy = y + pad + 8
  fill(pdf, C.frame); pdf.circle(cx0 + 3, hy - 3, 3, 'F')
  let hx = cx0 + 11
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); text(pdf, C.accentText)
  pdf.text('INTERPRETATION', hx, hy); hx += pdf.getTextWidth('INTERPRETATION') + 6
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); text(pdf, C.muted)
  const per = `· ${monthYear(interp.period_start)}`
  pdf.text(per, hx, hy); hx += pdf.getTextWidth(per) + 8
  if (interp.partial) {
    const pill = interp.grain === 'month' ? 'MTD' : 'to date'
    pdf.setFontSize(7.5)
    const pwid = pdf.getTextWidth(pill) + 10
    fill(pdf, C.pillBg); pdf.roundedRect(hx, hy - 8, pwid, 12, 6, 6, 'F')
    text(pdf, C.accentText); pdf.text(pill, hx + 5, hy)
  }

  // ── verdict ──────────────────────────────────────────────────────────────
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
  drawVerdict(pdf, interp, cx0, y + pad + headerH + gap1 + 9, cw, vLineH)

  // ── callout boxes ────────────────────────────────────────────────────────
  const boxTop = y + pad + headerH + gap1 + verdictH + gap2
  dims.forEach(([key, dim], i) => {
    const bx = cx0 + i * (boxW + gap)
    fill(pdf, C.cardBg); pdf.roundedRect(bx, boxTop, boxW, boxH, 9, 9, 'F')
    const ix = bx + boxPad
    let by = boxTop + boxPad + 8
    // label
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); text(pdf, C.muted)
    pdf.text(key.toUpperCase(), ix, by); by += 12
    // flag + reason
    if (dim.flag) {
      pdf.setFont('helvetica', 'bold'); text(pdf, C.accentDark)
      const flagLine = fitText(pdf, `${dim.flag.name} · ${pctS(dim.flag.dh)}`, boxIW, 10.5, 8)
      pdf.text(flagLine, ix, by); by += 13
      const reason = reasonFor(key, dim)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); text(pdf, C.muted)
      const rLines = pdf.splitTextToSize(reason, boxIW)
      pdf.text(rLines, ix, by); by += rLines.length * 10
    } else {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); text(pdf, C.muted)
      pdf.text('Not enough data to flag', ix, by); by += 14
    }
    // bright spot
    by += 2
    if (dim.bright) {
      draw(pdf, C.green); pdf.setLineWidth(1.2)
      pdf.line(ix, by - 3, ix + 2.5, by - 0.5); pdf.line(ix + 2.5, by - 0.5, ix + 6, by - 5)
      pdf.setFont('helvetica', 'normal'); text(pdf, C.green)
      pdf.text(fitText(pdf, `${dim.bright.name}  ${pctS(dim.bright.dh)}`, boxIW - 11, 8, 7), ix + 11, by)
      by += 11
    } else {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); text(pdf, C.muted)
      pdf.text('—', ix, by); by += 11
    }
    // region context — flows straight from the bright spot, no divider above it
    if (key === 'region' && dim.top) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); text(pdf, C.muted)
      pdf.text(pdf.splitTextToSize(contextFor(dim), boxIW), ix, by)
    }
  })

  // ── disclaimer ───────────────────────────────────────────────────────────
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); text(pdf, C.disc)
  pdf.text(discLines, cx0, boxTop + boxH + gap3 + 8)

  pdf.setLineWidth(0.2)
  return y + totalH
}
