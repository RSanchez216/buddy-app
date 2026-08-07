// Shared chrome for the expanded row's panels.
//
// One definition, because there were three: panels ①–⑤ used one heading
// treatment, ⑥ Logged activity used the lighter EYEBROW, and Broker risk had a
// third of its own. Same row, three sizes and three colours. Re-declaring the
// values at each site is exactly how they drifted, so the string lives here and
// the call sites import it.
//
// Numbering is unrelated to typography: Broker risk stays unnumbered and Logged
// activity stays ⑥. Only the heading treatment is shared.

export const PANEL_HEADING = 'text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide'

// The orange step circle beside ①–⑥. Broker risk does not take one — it is
// advisory, not a step in the sequence.
export const PANEL_STEP_BADGE = 'w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 inline-flex items-center justify-center text-[10px] font-bold'
