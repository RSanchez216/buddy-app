/**
 * Test script for parseur-webhook Edge Function.
 *
 * Run against local dev server:
 *   deno run --allow-net --allow-env supabase/functions/parseur-webhook/test.ts
 *
 * Or against production (set TARGET=prod):
 *   TARGET=prod PARSEUR_WEBHOOK_SECRET=your_secret deno run --allow-net --allow-env supabase/functions/parseur-webhook/test.ts
 */

const isProd = Deno.env.get('TARGET') === 'prod'

const BASE_URL = isProd
  ? 'https://vfvaxjdmobhyttgryymr.supabase.co/functions/v1/parseur-webhook'
  : 'http://localhost:54321/functions/v1/parseur-webhook'

const SECRET = Deno.env.get('PARSEUR_WEBHOOK_SECRET') || 'test-secret-replace-me'

// ── Mock payloads ──────────────────────────────────────────────────────────

const testCases = [
  {
    label: '✅ Full payload — known vendor, with PDF URL',
    payload: {
      vendor_name:    'Vanguard - Nato (Rentals)',   // change to a real vendor in your DB
      invoice_number: 'TEST-INV-001',
      invoice_date:   '2026-04-07',
      due_date:       '2026-04-14',
      total_amount:   '6349.68',
      email_subject:  'Invoice TEST-INV-001 from Vanguard',
      file_url:       'https://www.w3.org/WAI/WCAG21/Techniques/pdf/sample.pdf',
    },
  },
  {
    label: '⚠️  Unknown vendor — should set needs_vendor_match = true',
    payload: {
      vendor_name:    'Unknown Freight Co.',
      invoice_number: 'TEST-INV-002',
      invoice_date:   '2026-04-07',
      due_date:       '2026-04-21',
      total_amount:   '$1,250.00',
      email_subject:  'Invoice from Unknown Freight Co.',
      // no file_url — should still create invoice
    },
  },
  {
    label: '❌ No token — should return 401',
    noToken: true,
    payload: {
      vendor_name:    'Test Vendor',
      invoice_number: 'TEST-INV-003',
      total_amount:   '500',
    },
  },
]

// ── Runner ─────────────────────────────────────────────────────────────────

console.log(`\nRunning parseur-webhook tests against: ${BASE_URL}\n`)

for (const tc of testCases) {
  console.log(`--- ${tc.label}`)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (!(tc as any).noToken) {
      headers['x-parseur-token'] = SECRET
    }

    const res = await fetch(BASE_URL, {
      method:  'POST',
      headers,
      body:    JSON.stringify(tc.payload),
    })

    const body = await res.json()
    console.log(`  Status: ${res.status}`)
    console.log(`  Body:  `, JSON.stringify(body, null, 2))
  } catch (err) {
    console.error(`  ERROR: ${err}`)
  }
  console.log()
}
