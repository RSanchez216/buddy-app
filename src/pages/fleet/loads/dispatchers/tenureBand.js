// Shared tenure-band tokens so the desk modal and the Departures list modal
// render identical pills. Three bands, each its own problem: veteran (6+ mo,
// retention) → red; established (mid-tenure) → blue; new (≤60d, onboarding/fit)
// → amber. Point at these tokens — don't invent new colours.
export const BAND_CHIP = {
  veteran: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/25',
  established: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/25',
  new: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/25',
}
export const BAND_LABEL = { veteran: 'Veteran', established: 'Established', new: 'New' }
