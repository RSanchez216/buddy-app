import { createContext, useContext } from 'react'
import { usePresence } from '../hooks/usePresence'

// Lifts the single global presence subscription up so the facepile and the
// roster drawer share ONE channel instead of each opening its own.
const PresenceContext = createContext({ me: null, roster: [] })

export function PresenceProvider({ children }) {
  const presence = usePresence() // the Phase 1 hook, called exactly once here
  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>
}

export function usePresenceContext() {
  return useContext(PresenceContext)
}
