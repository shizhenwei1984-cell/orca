# Encounter integration

`transitionEncounter(previous, action, context)` in [encounters.js](./encounters.js) accepts version 1 state or `null`.
Pass epoch milliseconds as `now` and a `random()` source that returns values in [0, 1).
It returns a replacement `state` and `deltas`, or the original state with `error` and `deltas: null`.
A `tick` advances deadlines and can start one automatic exchange.

The trainer-save writer supplies `party` keyed by live slot, `items` keyed by item ID, `dex` and `daily` in upstream format, and settings.
Pass job count and the busiest species as `jobs` and `topDex`, the full saved roster as `ownedPicks`, and active badge modifiers as `perks`.
Pass `workingSlots` for raid damage, `weather` for the strip's active weather, and `xAttack` for the ambient spar cooldown.
Optional `ball` and `bait` are the preferred capture items.

On a successful transition, commit state and all deltas in one write.
Apply signed `items` quantities, `money`, the `marks.trainers` increment, the `marks.fullHearts` flag, and any `selection.ball` reset.
Merge `party` replacements and `box` insertions, record `seen` and each boxed catch in the Pokédex, and apply the research events in order.
The Box, research, and Pokédex ledgers can then issue their normal milestone payouts in that same write.
Health, the rival record, visitor timing, raid counters, spar records, and Tower progress live in the encounter state.

| Command                     | Fields and behavior                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `tick`                      | Settle deadlines, spawn scheduled visitors, and advance trainer battles.                        |
| `work`                      | Pass `before` and `after` for today's aggregate work minutes when recording work.               |
| `call`                      | Pass `item` as `honey` or `azure-flute` to spend it.                                            |
| `gift`                      | Pass active visitor `id`. Collect its gift and any purse.                                       |
| `nearby`                    | Pass visitor `id` and party `slot`. Trigger its one proximity act.                              |
| `throw`                     | Pass active visitor `id`. Optional `ball: null` selects Auto, and `bait: null` skips the Berry. |
| `attack`                    | Pass visitor `id`, party `slot`, and optional `move` name.                                      |
| `withdraw`                  | Pass trainer visitor `id`.                                                                      |
| `heal`                      | Pass party `slot` and healing `item`.                                                           |
| `party-switch`              | Pass party `slot` in the same transaction as a Box or picker replacement.                       |
| `tower-start`, `tower-quit` | Start or end a climb.                                                                           |
| `raid-hit`                  | Pass raid `id` and party `slot`.                                                                |
| `spar`                      | Pass party `slot` and `opponent` slot. Optional `source` is `drop`, `ambient`, or `wake`.       |

Call `renderEncounterSnapshot(state, context)` in [encounter-view.js](./encounter-view.js) for the panel model.
Mount with `mountEncounterPanel(node, { onAction, sprite })` in [encounter-panel.js](../panel/encounters/encounter-panel.js).
`onAction(command)` sends a command to the writer and returns the response or throws a transport error.
Call `render(snapshot)` on the mounted panel for updates and `destroy()` on teardown.
The optional `sprite(pick)` returns an asset URL for a visible fighter.

## Trainer writer and sidebar

Pass the exports from `trainer-encounters.mjs` to `activateTrainer(orca, extensions)`.
The trainer writer registers `encounter.read`, `encounter.command`, and `encounter.cry` through the extension. Both command handlers use the same save writer. Clients send terminal IDs for the workspace scope. Actions use actual party-slot keys and Pokémon identities from the most recent encounter snapshot. Commands also carry that snapshot's `revision`, a 36-digit lowercase hex `client` ID, and a positive, increasing `sequence`. Retry a lost reply with the same payload. A stale revision or stale Pokémon identity leaves the save untouched.

Mount `mountEncounterGame(container, { request, interactions, world, sprite, onSettings, signal })` from `panel/encounters/encounter-game.js` before the first roster event. Pass the sidebar's `worldInteractions` as `interactions` and the world container element as `world`. Its roster events provide the workspace identity, terminal roster, visitor setter, and workspace lifetime. Call `game.refresh()` when `trainer.changed` arrives. Call `game.update({ settings })` when the shared settings load or change, and merge the `{ battleSounds }` patch from `onSettings` into storage if the panel persists its sound switch.

Spread `encounterSprites(loadCatalogSprite)` from `panel/encounters/encounter-sprites.js` into the mount options. It supplies the battle portrait from the catalog. The world renders visitors from the same species, form, gender and shiny appearance used for companions. SFX and trainer art come from [Pokerdr at 11f949d](https://github.com/lntvan166/herdr-pokemon/tree/11f949d97dee013d636c4fa1baf7fc55a5f20627/mods/pokemon-herd) under the [upstream license](../LICENSE-upstream). The battle sound switch starts muted. When enabled, the trusted worker serves species cries from the same [PokeAPI cry collection](https://github.com/PokeAPI/cries) as Pokerdr.
