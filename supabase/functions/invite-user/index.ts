// supabase/functions/invite-user/index.ts
// Admin-only Edge Function: creates a Supabase auth user via the admin API,
// sends them an invite email, and inserts a matching row into public.users
// with status='pending'.
//
// Required environment variables (Supabase dashboard → Edge Functions):
//   SUPABASE_URL              (set automatically)
//   SUPABASE_SERVICE_ROLE_KEY (set automatically)
//   BUDDY_BASE_URL            (set manually, e.g. https://buddy-app-nine.vercel.app)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_ROLES = ['admin', 'manager', 'viewer'] as const
type Role = typeof ALLOWED_ROLES[number]

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isEmail(str: string) {
  return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    // Hardcoded prod fallback so a missing env var can't silently send the
    // invite to the project's default Site URL (which would skip set-password).
    const buddyBaseUrl = Deno.env.get('BUDDY_BASE_URL') || 'https://buddy-app-nine.vercel.app'

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 1) Verify caller via JWT
    const { data: callerAuth, error: callerErr } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (callerErr || !callerAuth?.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }
    const callerId = callerAuth.user.id

    // 2) Confirm caller is an active admin
    const { data: callerProfile, error: profileErr } = await supabaseAdmin
      .from('users')
      .select('role, status')
      .eq('id', callerId)
      .single()

    if (profileErr || !callerProfile) {
      return jsonResponse({ error: 'Caller profile not found' }, 403)
    }
    if (callerProfile.role !== 'admin' || callerProfile.status !== 'active') {
      return jsonResponse({ error: 'Admin access required' }, 403)
    }

    // 3) Validate body
    const body = await req.json().catch(() => null)
    if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400)

    const email = String(body.email || '').trim().toLowerCase()
    const full_name = String(body.full_name || '').trim()
    const role = body.role as Role

    if (!isEmail(email)) return jsonResponse({ error: 'Valid email is required' }, 400)
    if (!full_name)       return jsonResponse({ error: 'Full name is required' }, 400)
    if (!ALLOWED_ROLES.includes(role)) return jsonResponse({ error: 'Invalid role' }, 400)

    // 4) Send invite (creates an auth user in pending state and emails a magic link)
    const redirectTo = `${buddyBaseUrl.replace(/\/$/, '')}/auth/set-password`

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      { data: { full_name, role }, redirectTo }
    )
    if (inviteError) return jsonResponse({ error: inviteError.message }, 400)

    const newUserId = inviteData?.user?.id
    if (!newUserId) return jsonResponse({ error: 'Invite did not return a user id' }, 500)

    // 5) Upsert into public.users (insert; if a row already exists fall back to update)
    const insertPayload = {
      id: newUserId,
      email,
      full_name,
      role,
      status: 'pending',
      invited_by: callerId,
      invited_at: new Date().toISOString(),
    }
    const { error: insertError } = await supabaseAdmin
      .from('users')
      .upsert(insertPayload, { onConflict: 'id' })

    if (insertError) {
      return jsonResponse({ error: 'Profile insert failed: ' + insertError.message }, 500)
    }

    return jsonResponse({ success: true, user_id: newUserId }, 200)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error'
    return jsonResponse({ error: message }, 500)
  }
})
