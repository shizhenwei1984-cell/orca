# Pokémon Herd world

`import { mountWorld } from './world/world.js'` from the plugin panel. Mount on an empty block element with an available width. The world sizes itself vertically and loads its scoped stylesheet and local images.

```js
const world = mountWorld(container, {
  onFocus: (agent) => focusTerminal(agent.id),
  onPet: (agent) => petCompanion(agent.id),
  onMenu: ({ agent, visitor, x, y, anchor }) => openMenu({ agent, visitor, x, y, anchor }),
  onDrop: ({ agent, target, visitor, row, x, shaken }) => handleDrop(agent, target, visitor),
  onSpar: ({ first, second, reason }) => recordSpar(first, second, reason),
  onWild: (visitor) => inspectVisitor(visitor),
  onCommand: (command, agent) => openPanelControl(command, agent)
})
world.update({
  agents: [
    {
      id: 'terminal-id',
      label: 'Claude',
      species: 'Pikachu',
      state: 'working',
      stateStartedAt: Date.now(),
      focused: true
    }
  ],
  settings: { rows: 2, scale: 0.75, background: 'scenery', sky: 'bright' }
})
```

- `update(patch)` accepts an ordered `agents` array, a partial `settings` object, a `visitor` or `null`, and a fixed epoch `now` in milliseconds or `null` for real time. Send `agents: []` to clear the roster on a workspace switch. Call `dispose()` to unmount. Optional `clock` and `random` functions on mount support deterministic runs.
- Use unique, stable agent IDs. `working`, `waiting`, `blocked`, and `done` map directly from Orca. Explicit `idle` is for inputs that can confirm the agent is free. Sleep timing uses `stateStartedAt` for idle or completed agents. Completed companions retain their check when they nap. Both attention states keep their alerts and contribute to rain regardless of age. Optional `parentId` supports sub-agent grouping, and `sameFolderRival` identifies an agent working alongside another in the same reported terminal folder.
- `spriteSpecies` chooses a bundled starter sheet when the displayed species is an evolution. Supply `sprites` to replace the bundled art.
- Settings include `rows` (1–3), `scale` (0.5–1.25), `background` (`scenery` or `plain`), `sky` (`bright` or `muted`), `theme` (`light`, `dark` or `auto`), and booleans `weather`, `campfire`, `spar`, `tags`. A boolean `reducedMotion` overrides the default system preference. Patch settings without resending agents.
- Four existing starter sheets are used by default. Any agent or visitor may supply `sprites` with `idle`, `walk`, `sleep`, `idleL`, `idleR`, `idleD`, `walkL`, `walkR`, and `reactions` keyed by upstream animation names. Each sheet is `{ src, width, height, frames, duration, facing? }` with per-frame pixels, horizontal frames, total duration in milliseconds, and source direction `l`, `r` or `d`. Optionally supply `frameDurations` in milliseconds for uneven cels and `bottom` in unscaled pixels to trim transparent space at the feet. Scene code uses already resolved URLs and makes no host calls.
- A visitor is `{ id, label, species, row?, from?, to?, startedAt?, duration?, icon?, sprites? }`. Coordinates `from` and `to` are fractions of width and can extend past the edges. Omit them for a stationary visitor; use `visitor: null` to remove it. `onWild` activates it; `onDrop` handles a companion dropped on it. The panel owns visitor scheduling, game outcomes, rewards and storage.
- Activate a companion with a click, tap, Enter or Space to pet it and request host focus. P pets without requesting focus. Arrow keys navigate within the world. Context Menu, Shift+F10, right-click and long press open the corresponding menu. S and B dispatch the `settings` and `bag` commands when a command handler is supplied. The scene shows the moves in an ambient or drag-triggered spar; `onSpar` reports a presentation event with `reason` of `ambient`, `tease`, or `drop`.

## Sidebar integration

World is the default view. Party keeps the trainer cards and includes agent records without a listed terminal. In the world, P pets, S opens settings, and Shift+F10 opens the action popover. An explicit click, tap, Enter or Space on a companion returns focus to its terminal through the worker on desktop. The worker checks the terminal against the current workspace and needs Orca's `workspace:write` grant. The panel uses the `world.settings` plugin storage key for layout, scenery and opt-in sound. The browser's autoplay policy may require a panel interaction before sounds can play.

Sidebar extensions import `worldInteractions` from `../world-interactions.js`. Subscribe once per extension, using the extension's lifetime signal as the `addEventListener` option. Each event carries the following fields in `event.detail`, plus `workspaceId` when Orca supplies it.

| Event          | Detail                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roster`       | `agents`, workspace lifetime `signal`, and `setVisitor(visitorOrNull)`. Each notification replaces the previous snapshot. A setter from a previous workspace becomes inert. |
| `pet`          | `agent`                                                                                                                                                                     |
| `wild`         | `visitor`                                                                                                                                                                   |
| `drop`, `spar` | The matching world callback fields above                                                                                                                                    |
| `menu`         | `agent`, `visitor`, `anchor`, `x`, `y`                                                                                                                                      |
| `command`      | `command` and `agent`                                                                                                                                                       |

Call `event.preventDefault()` synchronously on `menu` or `command` when taking ownership of the action. Use this for a picker menu or to handle the `bag` shortcut. The panel handles Settings and the default action popover. Attach before the panel's first roster notification so encounters start with the current workspace.

## Credits

Scenery art and adapted scene, tag, rest, wrap, and reaction algorithms come from [Pokerdr at 11f949d](https://github.com/lntvan166/herdr-pokemon/tree/11f949d), distributed under the [included MIT notice](../../LICENSE-upstream). The trees, flowers, bushes, rocks, fire and embers were created for Pokerdr with ChatGPT image generation.

The fallback starter sprite sheets in the parent panel are repacks of [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab/tree/ced880d7598b9d505a267dbed5d05482197b05ff/sprite), credited to CHUNSOFT and distributed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Pokémon and the related names belong to their respective owners.
