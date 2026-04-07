import { useState } from 'react'

function FallbackIcon({ rounded = '2xl' }) {
  return (
    <div className={`w-full h-full flex items-center justify-center rounded-${rounded} bg-gradient-to-br from-cyan-400 via-cyan-500 to-fuchsia-500 shadow-lg shadow-cyan-500/30`}>
      <svg viewBox="0 0 40 40" fill="none" className="w-3/5 h-3/5">
        <rect x="8" y="7" width="5" height="26" rx="2.5" fill="white" />
        <rect x="8" y="7" width="18" height="11" rx="5.5" fill="white" />
        <rect x="8" y="22" width="20" height="11" rx="5.5" fill="white" />
        <circle cx="31" cy="10" r="2.5" fill="white" fillOpacity="0.6" />
        <line x1="28.5" y1="10" x2="26" y2="10" stroke="white" strokeWidth="1.5" strokeOpacity="0.6" />
      </svg>
    </div>
  )
}

export default function BuddyLogo({ className = 'w-12 h-12' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`${className} relative`}>
      {failed ? (
        <FallbackIcon rounded="2xl" />
      ) : (
        <img
          src="/buddy-logo.png"
          alt="BUDDY"
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

export function BuddyLogoSmall({ className = 'w-9 h-9' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`${className} relative flex-shrink-0`}>
      {failed ? (
        <FallbackIcon rounded="xl" />
      ) : (
        <img
          src="/buddy-logo.png"
          alt="BUDDY"
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
