// Client timeout for Supabase query/RPC builders. Wrap a builder so a cold or
// hung request surfaces as an error (→ retry UI) instead of a permanent
// blank/spinner. `build(signal)` should return the builder with
// .abortSignal(signal) applied so a real in-flight request is also cancelled.
// Default 20s — comfortably above the slowest warm query, but bounded so a
// stuck request can't spin forever.
//
// Why the timer both aborts AND rejects (not abort-only): abort() only settles
// the request if whatever is behind fetch honors the AbortSignal. A genuinely
// hung transport — or a test that patches `window.fetch = () => new Promise(
// () => {})`, which ignores the signal entirely — never rejects on abort, so an
// abort-only timeout hangs forever. Racing the builder against a timer that
// *rejects* guarantees the promise settles at `ms` regardless; the abort is the
// best-effort cancellation on top. Verify this by hanging a request (a
// signal-ignoring never-settling promise), not by rejecting one — a rejecting
// request settles either way and hides the gap.

export class TimeoutError extends Error {
  constructor(ms = 20000) {
    super(`Request timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout(build, ms = 20000) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new TimeoutError(ms)) }, ms)
  })
  // Promise.resolve adopts the (lazy, thenable) builder so it actually runs.
  return Promise.race([Promise.resolve(build(controller.signal)), timeout])
    .finally(() => clearTimeout(timer))
}
