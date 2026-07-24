import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// Real-time "who's online" on a single Supabase Realtime Presence channel.
// Each client tracks its identity + current route + a last-active timestamp,
// re-tracks on route change and on interaction, and writes users.last_seen_at
// on a throttled heartbeat. Presence is ephemeral and client-reported — a UX
// signal only; route/identity are self-declared, never gate anything on them.

const ACTIVE_WINDOW_MS = 2 * 60 * 1000 // interacted within 2 min → "active"
const HEARTBEAT_MS = 30 * 1000         // re-track cadence
const DB_TOUCH_MS = 60 * 1000          // throttle for touch_last_seen RPC
const IDLE_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'visibilitychange']

export function usePresence() {
  const location = useLocation()
  const { profile } = useAuth()
  // Identity comes from the already-loaded auth profile — no extra fetch.
  const myId = profile?.id ?? null
  const myName = profile?.full_name || 'User'

  const [roster, setRoster] = useState([])        // other online users
  const [now, setNow] = useState(() => Date.now()) // ticks so active→idle flips on its own
  const channelRef = useRef(null)
  const lastActiveRef = useRef(0)
  const lastDbTouchRef = useRef(0)
  const routeRef = useRef(location.pathname)
  const identityRef = useRef({ id: null, full_name: 'User' })

  // Keep the latest route + identity in refs so the stable callbacks below see
  // them without re-subscribing the channel each render.
  useEffect(() => { routeRef.current = location.pathname }, [location.pathname])
  useEffect(() => { identityRef.current = { id: myId, full_name: myName } }, [myId, myName])

  const trackState = useCallback(() => {
    const ch = channelRef.current
    const { id, full_name } = identityRef.current
    if (!ch || !id) return
    ch.track({
      user_id: id,
      full_name,
      route: routeRef.current,
      last_active: lastActiveRef.current,
    })
  }, [])

  const markActive = useCallback(() => {
    const t = Date.now()
    lastActiveRef.current = t
    if (t - lastDbTouchRef.current > DB_TOUCH_MS) {
      lastDbTouchRef.current = t
      supabase.rpc('touch_last_seen').then(({ error }) => {
        if (error) console.warn('touch_last_seen failed', error.message)
      })
    }
  }, [])

  // Subscribe to the channel once we know who we are.
  useEffect(() => {
    if (!myId) return
    const ch = supabase.channel('presence:global', {
      config: { presence: { key: myId } },
    })
    channelRef.current = ch

    const syncRoster = () => {
      const state = ch.presenceState() // { key: [ {..meta} ] }
      const others = []
      for (const key of Object.keys(state)) {
        if (key === myId) continue
        const meta = state[key][state[key].length - 1] // latest
        if (meta) others.push(meta)
      }
      setRoster(others)
    }

    ch.on('presence', { event: 'sync' }, syncRoster)
      .on('presence', { event: 'join' }, syncRoster)
      .on('presence', { event: 'leave' }, syncRoster)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          markActive()
          trackState()
        }
      })

    return () => {
      supabase.removeChannel(ch)
      channelRef.current = null
    }
  }, [myId, markActive, trackState])

  // Re-track on route change so others see my new page.
  useEffect(() => { trackState() }, [location.pathname, trackState])

  // Interaction listeners → mark active (+ throttled DB touch).
  useEffect(() => {
    const onEvent = () => markActive()
    IDLE_EVENTS.forEach((e) => window.addEventListener(e, onEvent, { passive: true }))
    return () => IDLE_EVENTS.forEach((e) => window.removeEventListener(e, onEvent))
  }, [markActive])

  // Heartbeat: re-track so others see fresh last_active + route, and advance the
  // local clock so a roster member's status can lapse active→idle without a
  // presence event arriving.
  useEffect(() => {
    const id = setInterval(() => { trackState(); setNow(Date.now()) }, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [trackState])

  const decorated = roster.map((u) => ({
    ...u,
    status: now - (u.last_active ?? 0) < ACTIVE_WINDOW_MS ? 'active' : 'idle',
    onMyPage: u.route === location.pathname,
  }))

  const me = myId ? { id: myId, full_name: myName } : null
  return { me, roster: decorated }
}
