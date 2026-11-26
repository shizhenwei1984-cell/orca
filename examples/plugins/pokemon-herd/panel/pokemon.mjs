const starters = [25, 1, 4, 7]

export const species = {
  1: { name: 'Bulbasaur', walk: 6, idle: 3, evolution: { dex: 2, jobs: 15 } },
  2: { name: 'Ivysaur', evolution: { dex: 3, jobs: 30 } },
  3: { name: 'Venusaur' },
  4: { name: 'Charmander', walk: 4, idle: 4, evolution: { dex: 5, jobs: 15 } },
  5: { name: 'Charmeleon', evolution: { dex: 6, jobs: 30 } },
  6: { name: 'Charizard' },
  7: { name: 'Squirtle', walk: 4, idle: 8, evolution: { dex: 8, jobs: 15 } },
  8: { name: 'Wartortle', evolution: { dex: 9, jobs: 30 } },
  9: { name: 'Blastoise' },
  25: { name: 'Pikachu', walk: 4, idle: 6, evolution: { dex: 26, item: 'Thunder Stone' } },
  26: { name: 'Raichu' }
}

export function starterDex(agent) {
  let hash = 0
  for (const char of agent.sessionId || agent.terminalId || agent.agent || 'Pokémon') {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  }
  return starters[hash % starters.length]
}
