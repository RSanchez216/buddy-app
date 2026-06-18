// Export utilities for Top Performers (Excel and PDF)
import { fmtMoney, fmtNum, fmtRpm } from '../spotlight/spotlightShared'

/**
 * Format data for export: add rank and format numbers as strings
 */
export function formatDataForExport(data, isDriver) {
  return data.map((item, idx) => ({
    rank: idx + 1,
    name: isDriver ? item.driver_name : item.dispatcher_name,
    gross: item.gross,
    grossFormatted: fmtMoney(item.gross),
    legs: item.legs,
    miles: item.miles || null,
    milesFormatted: item.miles ? fmtNum(item.miles) : '',
    rpm: item.rpm,
    rpmFormatted: fmtRpm(item.rpm),
    drivers: item.drivers || null,
  }))
}

/**
 * Export to Excel (.xlsx)
 */
export async function exportToExcel(data, isDriver, dateRange, phases, timestamp) {
  const XLSX = (await import('xlsx')).default

  const title = isDriver ? 'MANAS Express — Top Drivers' : 'MANAS Express — Top Dispatchers'
  const phasesLabel = Array.from(phases).sort().map(p =>
    p === 'in_transit' ? 'In transit' : p.charAt(0).toUpperCase() + p.slice(1)
  ).join(' + ')

  const formattedData = formatDataForExport(data, isDriver)

  // Build worksheet data
  const wsData = [
    [title],
    [`${dateRange.from} to ${dateRange.to} · ${phasesLabel} · Generated: ${timestamp}`],
    [],
    // Header row
    ['Rank', 'Name', 'Gross $', 'Loads', ...(isDriver ? ['Miles'] : []), 'RPM', ...(isDriver ? [] : ['Drivers'])],
  ]

  // Data rows
  formattedData.forEach(row => {
    wsData.push([
      row.rank,
      row.name,
      row.gross,
      row.legs,
      ...(isDriver ? [row.miles || 0] : []),
      row.rpm,
      ...(isDriver ? [] : [row.drivers || 0]),
    ])
  })

  // Create workbook
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Top Performers')

  // Set column widths
  const colWidths = isDriver
    ? [{ wch: 6 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }]
    : [{ wch: 6 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 8 }]
  ws['!cols'] = colWidths

  // Format header row (row 5, index 4)
  const headerRowIdx = 4
  for (let i = 0; i < wsData[headerRowIdx].length; i++) {
    const cellRef = XLSX.utils.encode_col(i) + (headerRowIdx + 1)
    if (!ws[cellRef]) continue
    ws[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: 'FFE8E8E8' } } }
  }

  // Format currency columns (Gross $)
  const grossColIdx = 2
  for (let i = 5; i < wsData.length; i++) {
    const cellRef = XLSX.utils.encode_col(grossColIdx) + (i + 1)
    if (!ws[cellRef]) continue
    ws[cellRef].z = '$#,##0'
  }

  // Format Miles column (column 4 for drivers)
  if (isDriver) {
    const milesColIdx = 4
    for (let i = 5; i < wsData.length; i++) {
      const cellRef = XLSX.utils.encode_col(milesColIdx) + (i + 1)
      if (!ws[cellRef]) continue
      ws[cellRef].z = '#,##0'
    }
  }

  // Format RPM column
  const rpmColIdx = isDriver ? 5 : 4
  for (let i = 5; i < wsData.length; i++) {
    const cellRef = XLSX.utils.encode_col(rpmColIdx) + (i + 1)
    if (!ws[cellRef]) continue
    ws[cellRef].z = '$0.00'
  }

  // Generate filename
  const filename = `MANAS_Top_${isDriver ? 'Drivers' : 'Dispatchers'}_${dateRange.from}_to_${dateRange.to}.xlsx`

  // Download
  XLSX.writeFile(wb, filename)
}

/**
 * Export to PDF with map header and table
 */
export async function exportToPDF(data, isDriver, dateRange, phases, timestamp, mapSvgElement) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const title = isDriver ? 'MANAS Express — Top Drivers' : 'MANAS Express — Top Dispatchers'
  const phasesLabel = Array.from(phases).sort().map(p =>
    p === 'in_transit' ? 'In transit' : p.charAt(0).toUpperCase() + p.slice(1)
  ).join(' + ')

  const formattedData = formatDataForExport(data, isDriver)

  // Create PDF (Letter, portrait)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  let yPos = 10

  // Add map as header image if available
  let mapImageHeight = 0
  if (mapSvgElement) {
    try {
      const mapImage = await svgToPng(mapSvgElement)
      const mapWidth = pageWidth - 20
      const mapAspectRatio = mapSvgElement.viewBox.baseVal.height / mapSvgElement.viewBox.baseVal.width
      mapImageHeight = mapWidth * mapAspectRatio
      doc.addImage(mapImage, 'PNG', 10, yPos, mapWidth, mapImageHeight)
      yPos += mapImageHeight + 10
    } catch (err) {
      console.error('Failed to add map to PDF:', err)
    }
  }

  // Add title block
  doc.setFontSize(14)
  doc.setFont(undefined, 'bold')
  doc.text(title, pageWidth / 2, yPos, { align: 'center' })
  yPos += 8

  doc.setFontSize(10)
  doc.setFont(undefined, 'normal')
  doc.text(`${dateRange.from} to ${dateRange.to} · ${phasesLabel}`, pageWidth / 2, yPos, { align: 'center' })
  yPos += 5
  doc.text(`Generated: ${timestamp}`, pageWidth / 2, yPos, { align: 'center' })
  yPos += 8

  // Add table
  const tableColumns = isDriver
    ? ['Rank', 'Driver', 'Gross $', 'Loads', 'Miles', 'RPM']
    : ['Rank', 'Dispatcher', 'Gross $', 'Loads', 'RPM', 'Drivers']

  const tableData = formattedData.map(row =>
    isDriver
      ? [row.rank, row.name, row.grossFormatted, row.legs, row.milesFormatted || '—', row.rpmFormatted]
      : [row.rank, row.name, row.grossFormatted, row.legs, row.rpmFormatted, row.drivers || '—']
  )

  autoTable(doc, {
    head: [tableColumns],
    body: tableData,
    startY: yPos,
    theme: 'grid',
    headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold' },
    bodyStyles: { textColor: [50, 50, 50] },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 10, right: 10 },
    didDrawPage(data) {
      // Footer with page number
      const pageCount = doc.internal.pages.length - 1
      if (pageCount > 0) {
        doc.setFontSize(8)
        doc.text(
          `Page ${data.pageNumber}`,
          pageWidth / 2,
          pageHeight - 10,
          { align: 'center' }
        )
      }
    },
  })

  const filename = `MANAS_Top_${isDriver ? 'Drivers' : 'Dispatchers'}_${dateRange.from}_to_${dateRange.to}.pdf`
  doc.save(filename)
}

/**
 * Convert SVG element to PNG data URL
 */
async function svgToPng(svgElement) {
  return new Promise((resolve, reject) => {
    try {
      // Clone and inline SVG styles
      const svgClone = svgElement.cloneNode(true)

      // Inline computed styles into SVG nodes
      const walker = svgClone.ownerDocument.createTreeWalker(
        svgClone,
        NodeFilter.SHOW_ELEMENT,
        null,
        false
      )

      let node
      while (node = walker.nextNode()) {
        const computedStyle = window.getComputedStyle(svgElement.querySelector(`[data-id="${node.getAttribute('data-id')}"]`) || svgElement)
        if (node.style) {
          if (computedStyle.fill) node.style.fill = computedStyle.fill
          if (computedStyle.stroke) node.style.stroke = computedStyle.stroke
          if (computedStyle.strokeWidth) node.style.strokeWidth = computedStyle.strokeWidth
        }
      }

      // Serialize SVG
      const serializer = new XMLSerializer()
      const svgString = serializer.serializeToString(svgClone)
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(svgBlob)

      // Render to canvas
      const canvas = document.createElement('canvas')
      canvas.width = svgElement.viewBox.baseVal.width
      canvas.height = svgElement.viewBox.baseVal.height
      const ctx = canvas.getContext('2d')

      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0)
        const pngData = canvas.toDataURL('image/png')
        URL.revokeObjectURL(svgUrl)
        resolve(pngData)
      }
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl)
        reject(new Error('Failed to load SVG for canvas rendering'))
      }

      img.src = svgUrl
    } catch (err) {
      reject(err)
    }
  })
}
