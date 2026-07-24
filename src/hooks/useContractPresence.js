import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Per-contract presence: joins presence:contract:{id} and tracks that I'm
// editing (with a start timestamp). Returns the OTHER people editing the same
// contract right now. Independent of the global presence channel.
//
// `active` scopes the channel to genuine edit mode — pass true only while the
// edit form is actually editable, so a read-only viewer never trips the lock.
export function useContractPresence(contractId, me, active) {
  const [others, setOthers] = useState([])
  // The context `me` is a fresh object each render — key the effect off the id
  // (a stable primitive) and read the name through a ref, so we don't
  // re-subscribe the channel on every render.
  const meId = me?.id ?? null
  const nameRef = useRef(me?.full_name || 'User')
  useEffect(() => { nameRef.current = me?.full_name || 'User' }, [me?.full_name])

  useEffect(() => {
    if (!active || !contractId || !meId) return

    const ch = supabase.channel(`presence:contract:${contractId}`, {
      config: { presence: { key: meId } },
    })
    const startedAt = Date.now()

    const sync = () => {
      const state = ch.presenceState()
      const list = []
      for (const key of Object.keys(state)) {
        if (key === meId) continue
        const meta = state[key][state[key].length - 1]
        if (meta) list.push(meta)
      }
      setOthers(list)
    }

    ch.on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.track({ user_id: meId, full_name: nameRef.current, editing_since: startedAt })
        }
      })

    return () => {
      supabase.removeChannel(ch)
      setOthers([])
    }
  }, [contractId, meId, active])

  return active ? others : [] // [] when you're the only editor / not editing
}
