# Pokémon catalog

The picker uses the walking species and forms from Pokerdr 2.44.0. Names, types, and unlock filters work offline. Normal Bulbasaur, Charmander, Squirtle, and Pikachu use the plugin's bundled sheets. Other looks load on demand and successful remote loads stay cached for the worker's lifetime. If a shiny or female sheet is missing, the preview can use the regular look of the same species or form. If that sheet is unavailable, the picker displays **Preview unavailable** and still allows eligible selections.

## Integrate the picker

1. Set the plugin manifest's execution to `trusted-worker` and point `main` to its worker entry. In the worker's `activate(orca)`, call `registerCatalogSprites(orca)` from `catalog/sprite-worker.mjs`.
2. Add `panel/catalog/picker.css` to the panel's stylesheets. Import `openCatalogPicker` from `panel/catalog/picker.mjs` and call it from the companion change control.
3. Pass the companion's `current` pick and an `onSelect(pick)` callback. Resolve the callback after saving and throw on failure so the picker stays open. Pass `favorites` and `onFavoritesChange(keys)` to persist favorites across picker openings. Orca's `storage:own` capability allows the panel to use `orca.storage` for both.
4. Pass `unlocks` from the game state. `caught` and `shinyUnlocked` are sets of dex numbers. `available` is an optional set of exact species and form keys, such as `37-0001`. `trainer` restricts choices to starters and caught species. `legendsOpen` allows uncaught legendary and mythical species. `taken` and `shinyOdds` are optional picker settings.

Call `loadCatalogSprite(pick, pose, { working, season, signal })` from `panel/catalog/sprite.mjs` to reuse the art outside the picker. It returns a sheet and frame data suitable for `playCatalogSprite(canvas, sprite, signal)`, or `null` if art is unavailable. Abort the signal when changing pose, changing companion, or clearing the canvas. The worker sends PNG data URLs over `orca.plugin.request`. The panel loads its bundled sheets via the plugin's own protocol.

## Credits

Species, forms, and genders come from Pokerdr revision `11f949d`. This port uses Pokerdr's type columns and legendary list. Pokerdr derives these tables from PokeAPI and SpriteCollab. See the [upstream source](https://github.com/lntvan166/herdr-pokemon/tree/11f949d/mods/pokemon-herd), [original MIT license](../LICENSE-upstream), and [PokeAPI](https://github.com/PokeAPI/pokeapi).

PMD SpriteCollab artists created the animation sheets. The loader reads the pinned SpriteCollab revision, and each sprite result carries its original `credits.txt` URL. The preview displays one facing from each sheet. The collection is distributed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). See the [per-sprite credits](https://github.com/PMDCollab/SpriteCollab/tree/ced880d7598b9d505a267dbed5d05482197b05ff/sprite). Pokémon and its characters belong to their respective owners.
