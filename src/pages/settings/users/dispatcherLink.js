// Linking a BUDDY login to a dispatcher record in the fleet data.
//
// This is manual on purpose: 0 of 52 dispatcher records match any user by name.
// The records carry nicknames — `Kadyraly (Kent) Berdaliev` — while logins are
// legal names, so there is no auto-match to be had.
//
// All three RPCs are live; users.dispatcher_id is NEVER written directly (the
// guard_user_privileged_columns trigger blocks non-admins, and link_user_dispatcher
// owns the one-record-one-login rule).

import { supabase } from '../../../lib/supabase'

// Search matches the legal name AND the nickname — nickname-only search is the
// point, since every load and Telegram message says "Kent", never "Kadyraly".
export async function searchDispatchers(query, includeLinked = false, limit = 25) {
  const { data, error } = await supabase.rpc('dispatcher_link_search', {
    p_query: query?.trim() || null,
    p_include_linked: !!includeLinked,
    p_limit: limit,
  })
  if (error) throw error
  return data || []
}

// Pass a null dispatcher id to unlink. Refusals come back as { ok:false, reason }
// — including the one-record-one-login guard, which names the other user.
export async function linkUserDispatcher(userId, dispatcherId) {
  const { data, error } = await supabase.rpc('link_user_dispatcher', {
    p_user_id: userId, p_dispatcher_id: dispatcherId ?? null,
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not link the dispatcher record.')
  return data
}

export async function fetchLinkStatus() {
  const { data, error } = await supabase.rpc('dispatcher_link_status')
  if (error) throw error
  return data || []
}

// The four states the status RPC reports, and how each reads in the users list.
// `suggestion_available` is the safeguard: a new dispatcher has no record until
// their first load imports, so they get invited unlinked — this surfaces the
// record the moment the importer creates it, instead of relying on memory.
export const LINK_STATE = {
  ok:                   { tone: 'text-gray-800 dark:text-slate-200' },
  not_linked:           { tone: 'text-red-600 dark:text-red-400 font-semibold', label: 'not linked' },
  suggestion_available: { tone: 'text-orange-600 dark:text-orange-400 font-semibold' },
  linked_no_drivers:    { tone: 'text-amber-600 dark:text-amber-400' },
}

// 'Kadyraly (Kent) Berdaliev' → 'Kadyraly Berdaliev'; the nickname renders as its
// own chip so the two aren't competing for the same line.
export function stripNickname(name) {
  return String(name || '').replace(/\s*\([^)]*\)\s*/, ' ').replace(/\s+/g, ' ').trim()
}
