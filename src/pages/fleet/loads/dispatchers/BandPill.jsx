import { BAND_CHIP, BAND_LABEL } from './tenureBand'

// Small tenure-band pill (New / Established / Veteran). Null band → nothing.
export default function BandPill({ band, className = '' }) {
  const label = BAND_LABEL[band]
  if (!label) return null
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium align-middle ${BAND_CHIP[band]} ${className}`}>
      {label}
    </span>
  )
}
