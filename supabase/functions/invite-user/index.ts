// supabase/functions/invite-user/index.ts
// Admin-only Edge Function.
//
// Two modes, chosen automatically by looking up the email first:
//   NEW USER      -> inviteUserByEmail + insert public.users row (status='pending')
//   EXISTING USER -> resetPasswordForEmail (a fresh single-use link), profile row left alone
//
// Why: invite links are SINGLE USE. Once the recipient clicks one, every later
// click returns "Email link is invalid or has expired", and inviteUserByEmail
// returns 422 email_exists — which is why "Resend invite" could never work for
// anyone who had already opened their original link.
//
// NOTE the email templates: the resend path sends the "Reset Password" template,
// not "Invite user". Both need to be branded or a fumbled first link drops the
// recipient back onto the Supabase default. See ../../templates/README.md.
//
// Required environment variables (Supabase dashboard -> Edge Functions):
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

// Scan the auth user list for a matching email. listUsers has no email filter,
// so page through it. Capped so a runaway loop can't hang the function.
async function findAuthUserByEmail(admin: any, email: string) {
  const PER_PAGE = 200
  const MAX_PAGES = 25
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) throw new Error('Could not list users: ' + error.message)
    const users = data?.users ?? []
    const hit = users.find(
      (u: any) => (u.email || '').trim().toLowerCase() === email
    )
    if (hit) return hit
    if (users.length < PER_PAGE) return null // last page
  }
  return null
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

    const redirectTo = `${buddyBaseUrl.replace(/\/$/, '')}/auth/set-password`

    // 4) Does this person already exist in auth?
    const existing = await findAuthUserByEmail(supabaseAdmin, email)

    // ---------------------------------------------------------------
    // RESEND PATH — existing auth user
    // ---------------------------------------------------------------
    if (existing) {
      const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo,
      })
      if (resetError) {
        return jsonResponse({ error: 'Could not send link: ' + resetError.message }, 400)
      }

      // If the auth user exists but has no profile row, create one so they are
      // not stranded without page access. An EXISTING profile is left untouched
      // on purpose: resending a link must never reset an active user back to
      // pending, or overwrite the role/name an admin has since edited.
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', existing.id)
        .maybeSingle()

      if (!profile) {
        if (!full_name) return jsonResponse({ error: 'Full name is required' }, 400)
        if (!ALLOWED_ROLES.includes(role)) return jsonResponse({ error: 'Invalid role' }, 400)
        const { error: insertError } = await supabaseAdmin.from('users').insert({
          id: existing.id,
          email,
          full_name,
          role,
          status: 'pending',
          invited_by: callerId,
          invited_at: new Date().toISOString(),
        })
        if (insertError) {
          return jsonResponse({ error: 'Profile insert failed: ' + insertError.message }, 500)
        }
      }

      return jsonResponse(
        {
          success: true,
          mode: 'resend',
          user_id: existing.id,
          message: 'A new sign-in link has been emailed. The previous link is no longer valid.',
        },
        200
      )
    }

    // ---------------------------------------------------------------
    // INVITE PATH — brand new user
    // ---------------------------------------------------------------
    if (!full_name) return jsonResponse({ error: 'Full name is required' }, 400)
    if (!ALLOWED_ROLES.includes(role)) return jsonResponse({ error: 'Invalid role' }, 400)

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      { data: { full_name, role }, redirectTo }
    )
    if (inviteError) return jsonResponse({ error: inviteError.message }, 400)

    const newUserId = inviteData?.user?.id
    if (!newUserId) return jsonResponse({ error: 'Invite did not return a user id' }, 500)

    const { error: insertError } = await supabaseAdmin.from('users').upsert(
      {
        id: newUserId,
        email,
        full_name,
        role,
        status: 'pending',
        invited_by: callerId,
        invited_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

    if (insertError) {
      return jsonResponse({ error: 'Profile insert failed: ' + insertError.message }, 500)
    }

    return jsonResponse({ success: true, mode: 'invite', user_id: newUserId }, 200)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error'
    return jsonResponse({ error: message }, 500)
  }
})
