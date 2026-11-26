import {
  abilityName,
  abilityOf,
  abilityText,
  megaAbility,
  slotsOf,
  works
} from '../../encounters/rules/abilities.js'
import { entryOf } from '../../catalog/dex.mjs'
import { chainOf, formsOf } from '../../encounters/rules/dex.js'
import { fighterKey } from '../../encounters/rules/trainer.js'

export function showAbilities(abilities, entry, mega) {
  const abilityKeys = mega
    ? [megaAbility(fighterKey(entry.dex, { mega: mega.kind }))].filter(Boolean)
    : [
        ...new Set(
          slotsOf(entry.dex, entry.form).flatMap((slot, abil) =>
            slot ? [abilityOf({ dex: entry.dex, form: entry.form, abil })] : []
          )
        )
      ]
  abilities.hidden = !abilityKeys.length
  const list = abilities.querySelector('ul')
  list.replaceChildren(
    ...abilityKeys.map((ability) => {
      const item = document.createElement('li')
      item.textContent = `${abilityName(ability)}. ${abilityText(ability)}${works(ability) ? '' : ' Inactive in this game.'}`
      return item
    })
  )
}

export function showEvolutionLine(evolutions, entry, onSelect) {
  const chain = chainOf(entry.dex)
  evolutions.hidden = chain.length < 2
  const formLabel = formsOf(entry.dex).find(({ form }) => form === entry.form)?.label
  evolutions.replaceChildren(
    ...chain.flatMap((stage) =>
      stage.flatMap((dex) => {
        const form = formLabel && formsOf(dex).find(({ label }) => label === formLabel)?.form
        const nextEntry = entryOf({ dex, form })
        if (!nextEntry) {
          return []
        }
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = nextEntry.name
        button.setAttribute('aria-pressed', String(nextEntry === entry))
        button.onclick = () => onSelect(nextEntry)
        return [button]
      })
    )
  )
}
