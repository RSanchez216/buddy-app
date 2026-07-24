import { useState } from 'react'
import { usePresence } from '../../hooks/usePresence'
import { avatarColor, initials } from '../../lib/presenceColor'

const MAX_VISIBLE = 3

function EyeIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function Avatar({ user, overlap }) {
  const [open, setOpen] = useState(false)
  const c = avatarColor(user.user_id)
  return (
    <div
      className="relative"
      style={{ marginLeft: overlap ? -8 : 0 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div
        className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-white text-xs font-medium dark:border-[#0d0d1f]"
        style={{ background: c.bg, color: c.fg }}
        aria-label={user.full_name}
      >
        {initials(user.full_name)}
      </div>
      {open && (
        <div className="absolute right-0 top-[36px] z-50 w-max rounded-lg border border-gray-200 bg-white p-2.5 shadow-2xl dark:border-white/10 dark:bg-[#0d0d1f]">
          <div className="mb-0.5 flex items-center gap-2">
            <span
              className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ background: user.status === 'active' ? '#1D9E75' : '#B4B2A9' }}
            />
            <span className="text-[13px] font-medium text-gray-900 dark:text-slate-100">
              {user.full_name}
            </span>
            <span className="text-xs text-gray-400 dark:text-slate-500">
              · {user.status === 'active' ? 'active now' : 'idle'}
            </span>
          </div>
          {user.onMyPage && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
              <EyeIcon /> viewing this page
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PresenceFacepile() {
  const { roster } = usePresence()
  if (roster.length === 0) return null

  // People on my page first, then active, then the rest.
  const sorted = [...roster].sort((a, b) => {
    if (a.onMyPage !== b.onMyPage) return a.onMyPage ? -1 : 1
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1
    return 0
  })

  const visible = sorted.slice(0, MAX_VISIBLE)
  const overflow = sorted.length - visible.length

  return (
    <div className="flex items-center" aria-label={`${roster.length} people online`}>
      {visible.map((u, i) => (
        <Avatar key={u.user_id} user={u} overlap={i > 0} />
      ))}
      {overflow > 0 && (
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-white bg-gray-100 text-[11px] font-medium text-gray-500 dark:border-[#0d0d1f] dark:bg-white/10 dark:text-slate-400"
          style={{ marginLeft: -8 }}
        >
          +{overflow}
        </div>
      )}
      {/* Divider lives with the facepile so it vanishes too when nobody's online. */}
      <div className="h-[22px] w-px bg-gray-200 dark:bg-white/10 ml-2.5 mr-1" />
    </div>
  )
}
