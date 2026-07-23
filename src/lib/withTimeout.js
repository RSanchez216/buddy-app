// Abort-based client timeout for Supabase query/RPC builders. Wrap a builder so
// a cold or hung request surfaces as an error (→ retry UI) instead of a
// permanent blank/spinner. `build(signal)` must return the builder with
// .abortSignal(signal) applied. Default 20s — comfortably above the slowest
// warm query, but bounded so a stuck request can't spin forever.
export async function withTimeout(build, ms = 20000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await build(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}
