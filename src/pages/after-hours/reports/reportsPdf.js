import {
  fmtRange, fmtDay, fmtClock, fmtTs, fmtHours, money, pct, shiftTypeLabel, kindMeta,
  shiftLogNotes, handoffAlreadyHasShiftLog, splitLumpers, lumperActor, lumperSource, shiftPdfFilename,
} from './reportsData'
import { pdfSafeText } from '../shift-board/shiftBoardData'

// PDF export for Shift Reports — the whole week, as the page reads on screen:
// the metric strip, the coverage grid, the shift history with each shift's
// detail, and the per-associate rollup.
//
// Tables are real autoTable tables, never screenshots, so every figure stays
// selectable and searchable in the exported file. jsPDF and jspdf-autotable are
// both already dependencies (the hand-off modal's Download PDF uses jsPDF, the
// dispatcher scorecard uses autoTable) — nothing new is added to the bundle, and
// both are imported dynamically so they stay out of the main chunk.
//
// There is no Recharts panel on this page — it's a metric strip, a coverage grid
// and three tables — so the clone-the-svg / inline-styles / canvas-at-2x recipe
// doesn't apply here. If a chart is ever added, that is the recipe to follow.
//
// pdfSafeText is the hand-off modal's helper: the built-in WinAnsi fonts can't
// encode emoji or dingbats, and a frozen handoff body opens with 🌙 and uses ⚠.
// Without stripping them those lines render as mojibake.
//
// Everything lives in one function scope on purpose. An earlier cut passed the
// table/heading helpers down into a separate detail renderer, which left two
// things advancing the cursor independently — the kind of drift that only shows
// up as overlapping text on the fourth shift of a busy week.

const ORANGE = [234, 88, 12]
const INK = [17, 24, 39]
const MUTED = [120, 120, 128]
const RULE = [226, 232, 240]
const ROSE = [190, 24, 93]

const M = 32 // page margin, pt

const COVER_LABEL = { covered: 'Covered', open: 'Open', gap: 'GAP', unused: '—' }
const COVER_FILL = { gap: [254, 226, 226], open: [255, 237, 213], covered: [236, 253, 245], unused: null }
const COVER_TEXT = { gap: [185, 28, 28], open: [194, 65, 12], covered: [4, 120, 87], unused: MUTED }

const txt = (v) => pdfSafeText(v == null || v === '' ? '—' : String(v))

// 24-hour Chicago clock for the SHIFT LOG lines — matches the Telegram body's
// `HH:MM  note` shape, which is 24h there and should not silently become 12h here.
const hhmm = (ts) => {
  if (!ts) return '--:--'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ts))
  } catch { return '--:--' }
}

// `onlyShiftId` narrows the whole document to one shift: the week summary, the
// coverage grid, the history table and the by-associate rollup all drop out and
// what remains is that shift's own block. It is the SAME renderer either way —
// the per-shift export is a parameter, not a fork, so the two can't drift.
export async function buildShiftReportsPdf({ week, totals, coverage, history, rollup, details = {}, filterNote = '', onlyShiftId = null }) {
  const single = onlyShiftId
    ? (history.find(r => r.shift_id === onlyShiftId && !r.is_gap) || null)
    : null
  if (onlyShiftId && !single) throw new Error('That shift is not in the current week.')

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const generated = fmtTs(new Date().toISOString())

  let y = 0

  // Header + page number on every page, including ones autoTable adds itself —
  // without the didDrawPage hook a table that spills lands on a bare sheet.
  const paintChrome = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK)
    doc.text(pdfSafeText(single
      ? `After Hours — ${fmtDay(single.shift_date)} · ${shiftTypeLabel(single.shift_type)}`
      : 'After Hours — Shift Reports'), M, 30)

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
    // A single-shift export still carries the week it was pulled from, so a
    // loose page can be placed without hunting for the date.
    doc.text(pdfSafeText(
      (single ? `${single.associate || '—'}   ·   week of ${fmtRange(week)}` : fmtRange(week))
      + `   ·   generated ${generated}`
    ), pw - M, 30, { align: 'right' })
    if (filterNote && !single) doc.text(pdfSafeText(filterNote), M, 42)

    doc.setDrawColor(...RULE); doc.setLineWidth(0.5)
    doc.line(M, 48, pw - M, 48)

    doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pw - M, ph - 14, { align: 'right' })
  }

  const newPage = () => { doc.addPage(); paintChrome(); y = 66 }
  const room = (need) => { if (y + need > ph - 28) newPage() }

  const heading = (label, sub) => {
    room(38)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...ORANGE)
    const up = label.toUpperCase()
    doc.text(pdfSafeText(up), M, y)
    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
      doc.text(pdfSafeText(sub), M + doc.getTextWidth(up) + 10, y)
    }
    y += 8
  }

  const table = (opts) => {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, top: 66, bottom: 28 },
      styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', textColor: INK, lineColor: RULE, lineWidth: 0.4 },
      headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 252] },
      didDrawPage: paintChrome,
      ...opts,
    })
    y = doc.lastAutoTable.finalY + 16
  }

  paintChrome()
  y = 66

  const nShifts = history.filter(r => !r.is_gap).length
  const nGaps = history.length - nShifts

  // ── Summary (the metric strip) ─────────────────────────────────────────────
  // Week-level sections. All four drop out for a single-shift export — the point
  // of that document is one shift, so a week summary, a coverage grid for days
  // it didn't run, and a rollup of other people's work are all noise.
  if (!single) {
  heading('Summary', `${totals.shifts} shifts · ${fmtHours(totals.hours)} covered${totals.open > 0 ? ` · ${totals.open} open` : ''}`)
  table({
    head: [['Avg reviewed', 'Booked', 'POD / BOL', 'Chkpt', 'Requests raised / handled', 'Escalations', 'Acc. claimed', 'Acc. collected', 'Lumpers']],
    body: [[
      pct(totals.avgReviewedPct), String(totals.booked), `${totals.pods} / ${totals.bols}`,
      String(totals.checkpoints), `${totals.requestsRaised} / ${totals.requestsHandled}`,
      String(totals.escalations), money(totals.accessorialsClaimed),
      money(totals.accessorialsCollected), money(totals.lumpersAmount),
    ]],
    styles: { fontSize: 8, cellPadding: 5, halign: 'center', overflow: 'linebreak', textColor: INK, lineColor: RULE, lineWidth: 0.4 },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontSize: 7, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: {},
  })

  // ── Coverage grid ──────────────────────────────────────────────────────────
  // Same states and colours as CoverageStrip. A GAP is inferred — interior days
  // only, and only for a type that ran twice or more — which is why "not in use"
  // is a state of its own rather than a miss.
  if (coverage?.rows?.length) {
    heading('Coverage')
    table({
      head: [['Shift', ...coverage.days.map(d => fmtDay(d, { weekday: 'short', day: 'numeric' }))]],
      body: coverage.rows.map(r => [shiftTypeLabel(r.type), ...r.cells.map(c => COVER_LABEL[c.state] || '—')]),
      columnStyles: { 0: { cellWidth: 92, fontStyle: 'bold', halign: 'left' } },
      styles: { fontSize: 7.5, cellPadding: 4, halign: 'center', textColor: INK, lineColor: RULE, lineWidth: 0.4 },
      alternateRowStyles: {},
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index === 0) return
        const cell = coverage.rows[data.row.index]?.cells?.[data.column.index - 1]
        if (!cell) return
        const fill = COVER_FILL[cell.state]
        if (fill) data.cell.styles.fillColor = fill
        data.cell.styles.textColor = COVER_TEXT[cell.state] || MUTED
        if (cell.state === 'gap') data.cell.styles.fontStyle = 'bold'
      },
    })
  }

  // ── Shift history ──────────────────────────────────────────────────────────
  // The whole week, gap rows included — never only what happens to be on screen.
  heading('Shift history', `${nShifts} shifts${nGaps ? ` · ${nGaps} gap${nGaps === 1 ? '' : 's'}` : ''}`)
  table({
    head: [['Date', 'Shift', 'Associate', 'Status', 'Start', 'End', 'Hrs', 'Rev', 'Rev %', 'Flag', 'Book', 'POD', 'BOL', 'Chk', 'Req', 'Esc']],
    body: history.map(r => r.is_gap
      ? [fmtDay(r.shift_date), shiftTypeLabel(r.shift_type), '—', 'no shift logged', '', '', '', '', '', '', '', '', '', '', '', '']
      : [
        fmtDay(r.shift_date), shiftTypeLabel(r.shift_type), txt(r.associate),
        r.is_open ? 'open' : (r.status || 'closed'),
        r.started_at ? fmtClock(r.started_at) : '—',
        r.ended_at ? fmtClock(r.ended_at) : '—',
        r.hours == null ? '—' : fmtHours(r.hours),
        String(r.drivers_reviewed ?? 0), pct(r.reviewed_pct),
        String(r.drivers_flagged ?? 0), String(r.loads_booked ?? 0),
        String(r.pods ?? 0), String(r.bols ?? 0), String(r.checkpoints ?? 0),
        `${r.requests_raised ?? 0}/${r.requests_handled ?? 0}`,
        String(r.escalations ?? 0),
      ]),
    columnStyles: {
      0: { cellWidth: 62 }, 1: { cellWidth: 74 }, 2: { cellWidth: 104 }, 3: { cellWidth: 66 },
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
      8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' },
      12: { halign: 'right' }, 13: { halign: 'right' }, 14: { halign: 'right' }, 15: { halign: 'right' },
    },
    didParseCell: (data) => {
      const r = history[data.row.index]
      if (data.section !== 'body' || !r) return
      if (r.is_gap) { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'italic' }
      else if (data.column.index === 15 && Number(r.escalations) > 0) {
        data.cell.styles.textColor = ROSE; data.cell.styles.fontStyle = 'bold'
      }
    },
  })
  } // end week-only sections

  // ── Per-shift detail ───────────────────────────────────────────────────────
  // The same blocks the expanded row shows, in reading order rather than the
  // screen's two columns — a PDF page is wide, not tall.
  const detailed = (single ? [single] : history.filter(r => !r.is_gap))
    .filter(r => details[r.shift_id]?.data)
  if (detailed.length) {
    if (!single) heading('Shift detail', `${detailed.length} of ${nShifts} shifts`)
    for (const row of detailed) {
      const d = details[row.shift_id].data
      room(96)

      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK)
      doc.text(pdfSafeText(`${fmtDay(row.shift_date)} · ${shiftTypeLabel(row.shift_type)} · ${row.associate || '—'}`), M, y)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
      doc.text(pdfSafeText(
        `${fmtClock(d.started_at)} → ${d.is_open ? 'open' : fmtClock(d.ended_at)}`
        + (d.handoff?.handed_to ? `   ·   handed to ${d.handoff.handed_to}` : '')
        + (d.handoff?.is_frozen ? '   ·   handoff frozen' : '')
      ), M, y + 11)
      y += 24

      // This shift's own metrics. On a week export the history table above
      // already carries them, so they'd be a second copy; on a single-shift
      // export that table isn't there and these are the only numbers.
      if (single) {
        table({
          head: [['Hours', 'Reviewed', 'Rev %', 'Flagged', 'Booked', 'POD / BOL', 'Chkpt', 'Requests', 'Escalations', 'Accessorials']],
          body: [[
            row.hours == null ? '—' : fmtHours(row.hours),
            `${row.drivers_reviewed ?? 0} / ${row.active_drivers ?? 0}`,
            pct(row.reviewed_pct),
            String(row.drivers_flagged ?? 0),
            String(row.loads_booked ?? 0),
            `${row.pods ?? 0} / ${row.bols ?? 0}`,
            String(row.checkpoints ?? 0),
            `${row.requests_raised ?? 0} raised / ${row.requests_handled ?? 0} handled`,
            String(row.escalations ?? 0),
            money(row.accessorials_claimed, 2),
          ]],
          styles: { fontSize: 8, cellPadding: 5, halign: 'center', overflow: 'linebreak', textColor: INK, lineColor: RULE, lineWidth: 0.4 },
          headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontSize: 7, fontStyle: 'bold', halign: 'center' },
          alternateRowStyles: {},
        })
      }

      // Handoff body verbatim, behind a rule so it reads as a quotation and can't
      // be mistaken for the report's own prose.
      if (d.handoff?.text) {
        doc.setFont('courier', 'normal'); doc.setFontSize(7)
        for (const ln of doc.splitTextToSize(pdfSafeText(d.handoff.text), pw - 2 * M - 14)) {
          if (y > ph - 34) newPage()
          doc.setDrawColor(...RULE); doc.setLineWidth(1.5)
          doc.line(M + 2, y - 6, M + 2, y + 2)
          doc.setTextColor(60, 60, 66)
          doc.text(ln, M + 12, y)
          y += 9
        }
        y += 10
      }

      // ── SHIFT LOG ────────────────────────────────────────────────────────
      // Running notes, oldest first, HH:MM Chicago — the same shape as the
      // Telegram body.
      //
      // Rendered ONLY when the frozen handoff above isn't already showing them.
      // handoff_text is stored as it was sent and never re-renders: a shift
      // frozen after the feature shipped already contains its own SHIFT LOG
      // section, and printing a live one too would duplicate it. A shift frozen
      // before it never will, so the live section is the only way those notes
      // appear. Notes added after the freeze also land here, correctly — they
      // happened, and the frozen text cannot retroactively contain them.
      const notes = shiftLogNotes(d)
      if (notes.length && !handoffAlreadyHasShiftLog(d)) {
        room(30)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...ORANGE)
        doc.text('SHIFT LOG', M, y)
        y += 10
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(60, 60, 66)
        for (const n of notes) {
          const stamp = hhmm(n.at)
          // Continuation lines of a multi-line note indent under their own entry
          // rather than starting a new bullet.
          const wrapped = doc.splitTextToSize(pdfSafeText(String(n.note)), pw - 2 * M - 52)
          wrapped.forEach((ln, i) => {
            if (y > ph - 34) newPage()
            if (i === 0) {
              doc.setTextColor(...MUTED); doc.text(stamp, M + 6, y)
              doc.setTextColor(60, 60, 66)
            }
            doc.text(ln, M + 46, y)
            y += 9
          })
        }
        y += 10
      }

      // Drivers: exceptions only, matching the screen's default view, with the
      // same one-line summary so the cleared ones are still accounted for.
      const drivers = d.drivers || []
      const counts = d.driver_counts || {}
      const exceptions = drivers.filter(x => x.is_exception === true)
      const nReviewed = counts.reviewed ?? drivers.length
      const nCleared = counts.cleared ?? Math.max(nReviewed - exceptions.length, 0)

      room(30)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
      doc.text(pdfSafeText(`Drivers — ${nReviewed} reviewed, ${exceptions.length} needed action, ${nCleared} cleared with no action.`), M, y)
      y += 8

      if (exceptions.length) {
        table({
          head: [['Driver', 'Load', 'Outcome', 'Note', 'Checked']],
          body: exceptions.map(x => [
            txt(x.driver), txt(x.load_number),
            x.outcome === 'issue' ? 'Issue' : x.outcome === 'needs_load' ? 'Needs load' : 'OK',
            txt(x.issue_note), fmtClock(x.checked_at),
          ]),
          columnStyles: { 0: { cellWidth: 120 }, 1: { cellWidth: 80 }, 2: { cellWidth: 62 }, 4: { cellWidth: 54, halign: 'right' } },
        })
      }

      // Activity log — every entry, not the screen's first eight. Shift-log notes
      // arrive in this list already (the detail RPC selects every shift_activities
      // row for the shift); they read as "Note" with no driver or load beside them.
      const timeline = d.timeline || []
      if (timeline.length) {
        table({
          head: [['Time', 'Entry', 'Driver', 'Load', 'Detail']],
          body: timeline.map(e => {
            const bits = []
            if (e.escalated_to) bits.push(`to ${e.escalated_to}`)
            if (e.acknowledged_at) bits.push(`ack ${fmtClock(e.acknowledged_at)}`)
            if (e.lag_hours != null) bits.push(`${Number(e.lag_hours).toFixed(1)}h to handle`)
            if (e.amount != null) bits.push(money(e.amount, 2))
            if (e.raised_by) bits.push(`raised by ${e.raised_by}`)
            return [
              fmtClock(e.occurred_at), kindMeta(e.kind).label,
              txt(e.driver), txt(e.load_number),
              pdfSafeText([e.note, bits.join(' · ')].filter(Boolean).join('  —  ') || '—'),
            ]
          }),
          columnStyles: {
            0: { cellWidth: 46, halign: 'right' }, 1: { cellWidth: 92, fontStyle: 'bold' },
            2: { cellWidth: 104 }, 3: { cellWidth: 74 },
          },
        })
      } else {
        room(20)
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
        doc.text('Nothing logged on this shift.', M, y)
        doc.setFont('helvetica', 'normal')
        y += 18
      }

      // ── Lumpers ──────────────────────────────────────────────────────────
      // Split by who actually entered them. The shift's window matches on TIME,
      // not actor, so an event recorded the next morning by someone who wasn't
      // on shift still falls inside it. Those are kept — they are real context
      // for this shift's loads — but they are no longer credited to the
      // associate. Subtotals are on total_amount, which includes the EFS fee.
      const L = splitLumpers(d)
      if (L.all.length) {
        room(40)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...ORANGE)
        doc.text('LUMPERS', M, y)
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED)
        doc.text(pdfSafeText(`${L.all.length} event${L.all.length === 1 ? '' : 's'}  ·  ${money(L.total, 2)} advanced, EFS fee included`), M + 52, y)
        y += 10

        for (const sec of [
          { label: 'Raised on shift', hint: 'recorded by the associate on shift', rows: L.onShift, sub: L.onShiftTotal },
          { label: 'Entered by others during this window', hint: 'the window matches on time, not on who recorded it', rows: L.others, sub: L.othersTotal },
        ]) {
          room(26)
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...INK)
          doc.text(pdfSafeText(sec.label), M + 6, y)
          doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED)
          doc.text(pdfSafeText(`— ${sec.hint}`), M + 6 + doc.getTextWidth(sec.label) + 6, y)
          doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK)
          doc.text(pdfSafeText(money(sec.sub, 2)), pw - M, y, { align: 'right' })
          doc.setFont('helvetica', 'normal')
          y += 6

          if (!sec.rows.length) {
            doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...MUTED)
            doc.text('None.', M + 12, y + 6)
            doc.setFont('helvetica', 'normal')
            y += 16
            continue
          }
          table({
            head: [['Load', 'Amount', 'EFS fee', 'Total', 'Recorded by', 'Entered', 'Source']],
            body: sec.rows.map(l => [
              txt(l.load_number), money(l.amount, 2), money(l.efs_fee, 2), money(l.total_amount, 2),
              pdfSafeText(lumperActor(l)), fmtTs(l.created_at), lumperSource(l),
            ]),
            columnStyles: {
              0: { cellWidth: 70 },
              1: { cellWidth: 58, halign: 'right' }, 2: { cellWidth: 52, halign: 'right' },
              3: { cellWidth: 62, halign: 'right', fontStyle: 'bold' },
              4: { cellWidth: 118 }, 5: { cellWidth: 92 },
            },
          })
        }
        doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(...MUTED)
        room(14)
        doc.text('Source shows where the row came from. No field separates a shift-board entry from one made in the Lumpers section.', M, y)
        doc.setFont('helvetica', 'normal')
        y += 16
      }
    }
  }

  // ── By associate ───────────────────────────────────────────────────────────
  if (!single && rollup?.length) {
    room(80)
    heading('By associate')
    table({
      head: [['Associate', 'Shifts', 'Hours', 'Avg reviewed', 'Booked', 'Paperwork', 'Chkpt', 'Req handled', 'Avg to handle', 'Esc', 'Acc claimed', 'Acc collected', 'Lumpers']],
      body: rollup.map(r => [
        txt(r.associate),
        `${r.shifts}${r.shifts_open > 0 ? ` (${r.shifts_open} open)` : ''}`,
        fmtHours(r.hours), pct(r.avg_reviewed_pct),
        String(r.booked ?? 0), String(r.paperwork ?? 0), String(r.checkpoints ?? 0), String(r.requests_handled ?? 0),
        r.avg_hours_to_handle == null ? '—' : `${Number(r.avg_hours_to_handle).toFixed(1)}h`,
        String(r.escalations ?? 0),
        money(r.accessorials_claimed, 2), money(r.accessorials_collected, 2), money(r.lumpers_amount, 2),
      ]),
      columnStyles: {
        0: { cellWidth: 120, fontStyle: 'bold' },
        ...Object.fromEntries([...Array(12)].map((_, i) => [i + 1, { halign: 'right' }])),
      },
      didParseCell: (data) => {
        const r = rollup[data.row.index]
        if (data.section !== 'body' || !r) return
        // The same two emphases the on-screen table makes.
        if (data.column.index === 8 && Number(r.avg_hours_to_handle) > 3) {
          data.cell.styles.textColor = [180, 83, 9]; data.cell.styles.fontStyle = 'bold'
        }
        if (data.column.index === 9 && Number(r.escalations) > 0) {
          data.cell.styles.textColor = ROSE; data.cell.styles.fontStyle = 'bold'
        }
      },
    })
  }

  doc.save(single ? shiftPdfFilename(single) : `shift-reports-${week.start}-to-${week.end}.pdf`)
}
