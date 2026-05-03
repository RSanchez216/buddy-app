// Picks dark or light text for a given background hex via WCAG luminance.
function readableTextColor(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return '#111827'
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.55 ? '#1F2937' : '#FFFFFF'
}

export default function StatusPill({ name, colorHex }) {
  const bg = colorHex || '#5F5E5A'
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: bg, color: readableTextColor(bg) }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {name || 'Unknown'}
    </span>
  )
}
