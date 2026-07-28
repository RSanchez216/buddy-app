import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { usePageAccess } from '../contexts/PageAccessContext'

// Keeps document.title in sync with the current route so multiple open tabs are
// distinguishable ("Idle review · BUDDY", "Lumpers · BUDDY", …). The page name
// is resolved from the SAME my_pages() rows the sidebar/nav uses (label +
// route), so there's no second hardcoded list; LABEL_OVERRIDES already applied
// upstream carry through. Fires on every client-side navigation.

const BASE = 'BUDDY'
const FALLBACK = 'BUDDY — Manas Express'

const norm = (s) => (s || '').replace(/\/+$/, '') || '/'

// Longest route-prefix match, so detail routes (e.g. /fleet/trucks/64) inherit
// their list page's label (Trucks) even though only /fleet/trucks is a page row.
function resolveLabel(pathname, pages) {
  const path = norm(pathname)
  let best = null, bestLen = -1
  for (const p of pages || []) {
    const r = norm(p.route)
    if (r === '/') continue
    if (path === r || path.startsWith(r + '/')) {
      if (r.length > bestLen) { best = p; bestLen = r.length }
    }
  }
  return best?.label || null
}

export function usePageTitle() {
  const location = useLocation()
  const { pages } = usePageAccess()
  useEffect(() => {
    const label = resolveLabel(location.pathname, pages)
    document.title = label ? `${label} · ${BASE}` : FALLBACK
  }, [location.pathname, pages])
}
