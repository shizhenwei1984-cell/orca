# Pokémon catalog

The picker's names, types, and unlock filters work offline. Normal Bulbasaur, Charmander, Squirtle, and Pikachu use bundled sheets. Other looks load on demand. If a shiny or female sheet is missing, the preview can use the regular look of the same species or form. If that sheet is unavailable, the picker displays **Preview unavailable** and still allows eligible selections.

## Appearance and storage

`trainer.game` supplies the party's current appearance, identity reference and catalog unlocks. The trainer's serialized `choose` action validates that reference, species, form, gender, Mega and shiny unlock before applying the pick. `trainer.read` projects the current appearance for the cards and world, including when the companion evolves.

The worker stores favorite catalog keys and the new-companion source under `catalog.preferences`. All available Pokémon is the default for new installs. Existing saves without a source preference keep Starters, and explicit choices keep their saved value. Favorites and All available Pokémon use the trainer’s unlocks. When the favorite pool has no eligible Pokémon, the worker uses a starter.

`loadCatalogSprite(pick, pose, { working, season, signal })` returns a PNG and frame metadata or `null`. The worker requests validated animation names and catalog folders at one pinned SpriteCollab revision. It rejects redirects and bounds response sizes and PNG dimensions. The worker stores successful sheets and their credits in two 224 KiB Orca storage buckets, with least recently used sheets evicted within each bucket. Individual PNG downloads are limited to 160 KiB. Both trainer save banks can use 4.5 MiB of the host's 5 MiB plugin storage limit. Bundled art is always available, and sheets retained in the cache can be reused offline after a worker restart.

## Credits

Species, forms, and genders come from Pokerdr revision `11f949d`. This port uses Pokerdr's type columns and legendary list. Pokerdr derives these tables from PokeAPI and SpriteCollab. See the [upstream source](https://github.com/lntvan166/herdr-pokemon/tree/11f949d/mods/pokemon-herd), [original MIT license](../LICENSE-upstream), and [PokeAPI](https://github.com/PokeAPI/pokeapi).

PMD SpriteCollab artists created the animation sheets. The loader reads the pinned SpriteCollab revision, and each sprite result carries its original `credits.txt` URL. The preview displays one facing from each sheet. The collection is distributed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). See the [per-sprite credits](https://github.com/PMDCollab/SpriteCollab/tree/ced880d7598b9d505a267dbed5d05482197b05ff/sprite). Pokémon and its characters belong to their respective owners.
