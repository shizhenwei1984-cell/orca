import { STAB } from '../encounters/rules/moves.js'
import { typeLabel } from '../encounters/rules/types.js'

export function moveInfo(move) {
  const { name, type, kind, power, accuracy, recommended, sameType, details } = move
  const metadata = [
    typeLabel(type),
    kind,
    power ? `Power ${power}` : null,
    accuracy === null ? null : `${accuracy}% accuracy`,
    sameType ? `Same type ×${STAB}` : null,
    recommended ? 'Recommended' : null
  ].filter(Boolean)
  const info = document.createElement('details')
  const summary = document.createElement('summary')
  const title = document.createElement('strong')
  title.textContent = name
  const stats = document.createElement('small')
  stats.textContent = metadata.join(' · ')
  summary.append(title, stats)
  const facts = document.createElement('ul')
  for (const detail of details) {
    const fact = document.createElement('li')
    fact.textContent = detail
    facts.append(fact)
  }
  info.append(summary, facts)
  return info
}
