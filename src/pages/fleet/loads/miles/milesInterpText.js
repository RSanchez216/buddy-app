// Plain-text helpers + verdict wording shared by the on-screen interpretation
// card and the PDF export, so both read identically. The card layers colour on
// top of the same wording — keep verdictText() in sync with the card's <Verdict>.

export const n0 = (n) => Number(n ?? 0).toLocaleString('en-US')
export const loadsLabel = (n) => `${n0(n)} load${Number(n) === 1 ? '' : 's'}`
export const pctS = (x) => (x == null ? '—' : `${Number(x).toFixed(1)}%`)
export const rpmS = (x) => (x == null ? '—' : `$${Number(x).toFixed(2)}`)
export const rpmPhrase = (t) => (t === 'down' ? 'eased' : t === 'up' ? 'firmed' : 'held')

export function monthNameOf(ymd) {
  const [y, m] = String(ymd || '').split('-').map(Number)
  if (!y || !m) return ''
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })
}
export const trendPhraseText = (t, d) =>
  t === 'up' ? `up ${Number(d).toFixed(1)}pt` : t === 'down' ? `down ${Math.abs(Number(d)).toFixed(1)}pt` : 'about level'
export const trendWordText = (t) =>
  t === 'up' ? 'trending the wrong way' : t === 'down' ? 'improving' : 'holding steady'

// Plain verdict narrative for the active grain — mirror of the card's <Verdict>.
export function verdictText(interp) {
  const { grain, overall, prev, dh_delta, dh_trend, rpm_trend } = interp
  const hasPrev = prev && prev.dh != null
  if (grain === 'day') {
    return `Partial day so far — ${loadsLabel(overall.loads)} at ${pctS(overall.dh)} deadhead`
      + `${hasPrev ? `, vs yesterday's ${pctS(prev.dh)} for reference` : ''}.`
      + ` A single day is a pulse, not a trend — the callouts below sit on small samples.`
  }
  if (grain === 'week') {
    return `Week to date: ${loadsLabel(overall.loads)}, ${pctS(overall.dh)} deadhead`
      + `${hasPrev ? ` — ${trendPhraseText(dh_trend, dh_delta)} vs the same point last week (${pctS(prev.dh)}), and RPM ${rpmPhrase(rpm_trend)} to ${rpmS(overall.rpm)} from ${rpmS(prev.rpm)}` : ''}.`
  }
  if (grain === 'month') {
    return `${monthNameOf(interp.period_start)} MTD: ${loadsLabel(overall.loads)}, ${pctS(overall.dh)} deadhead`
      + `${hasPrev ? ` vs ${pctS(prev.dh)} at this point last month (${trendWordText(dh_trend)}), and RPM ${rpmPhrase(rpm_trend)} to ${rpmS(overall.rpm)} from ${rpmS(prev.rpm)}` : ''}.`
      + ` Volume is healthy; empty miles are the leak.`
  }
  return `Selected range: ${loadsLabel(overall.loads)}, ${pctS(overall.dh)} deadhead, ${rpmS(overall.rpm)} RPM loaded. Custom ranges are summarized, not compared — pick a comparison range for a delta.`
}
