import { createContext, useContext } from 'react'
import { usePresence } from '../hooks/usePresence'
import { usePageActivity } from '../hooks/usePageActivity'
import { usePageTitle } from '../hooks/usePageTitle'

// Lifts the single global presence subscription up so the facepile and the
// roster drawer share ONE channel instead of each opening its own.
const PresenceContext = createContext({ me: null, roster: [] })

export function PresenceProvider({ children }) {
  const presence = usePresence() // the Phase 1 hook, called exactly once here
  // Page-activity logging (view/heartbeat) — likewise a single global mount,
  // and this sits inside Auth + PageAccess + Router so it can resolve page_key.
  usePageActivity()
  // Per-route browser-tab title ("{Page} · BUDDY"), reusing the nav's labels.
  usePageTitle()
  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>
}

export function usePresenceContext() {
  return useContext(PresenceContext)
}
