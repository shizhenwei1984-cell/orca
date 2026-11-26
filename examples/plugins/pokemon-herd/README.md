# Pokémon Herd for Orca

Open **Pokémon Herd** to show the map below the terminal in a desktop build with native plugin docking. Use **Move panel** to dock it at the bottom, in the left sidebar, or in the right sidebar. Orca remembers the position when you reopen the map. In **World**, each linked terminal agent in the current workspace gets a Pokémon. It walks while working, stands alert while waiting or blocked, and rests when done. Click a companion or press Enter on it to pet it and return to its terminal. Press P on a focused companion to pet it without leaving the panel. Friendship rewards have a cooldown.

Open **World actions** or right-click the ground for the Box, Bag, Shop, Research, Pokédex, and encounter controls. Press B or Alt+Shift+B while the world has focus to open the Bag. Right-click a companion, press Shift+F10 while it has focus, or touch and hold to open its actions. Use this menu to see moves and abilities, use an item from the Bag, change a held item, or open Mega settings for an eligible species. Choose **Swap with another agent** to exchange companions between two live terminals in the current workspace. Friendship and items follow each Pokémon, and each terminal keeps its work record. Finish an active fight before swapping its participants. Alt+Shift+P opens the picker for the focused companion.

Open **Settings** to change scenery, weather, the campfire, or the visitor rate. You can turn off outbreaks, new raids, world sparring, item pickup, and evolution through work. Active raids can finish after you turn off new raids. You can also choose moves manually against trainers. Battle sounds, companion cries, and pet and sparring sounds start muted.

The trainer summary shows Pokédollars, time worked, finished jobs and Rare Candy. Open **Party** to see each companion's work, friendship and evolution progress.

Install the folder with `orca plugin install ./examples/plugins/pokemon-herd`. Review the trusted worker and its workspace, terminal, agent and storage grants. The sidebar uses workspace creation and terminal access to create workspaces and to open or close terminals. Open the map with `orca plugin open local.pokemon-herd --panel pokemon-herd`.

Open **Trainer** to use the Bag and Shop, browse the Box and Pokédex, or check Research and badges. Use **Care** on a Pokémon's card to pet it, give it an item, rename it, or move it to the Box. In the Box, choose **Put in Day Care** to leave a parent. Compatible parents can lay an egg as your agents work. Hatched Pokémon join the Box and Pokédex.

In the trainer's **Party**, use **Change Pokémon** to find a species or form and preview its appearance. New companions come from the starters by default. Choose **All available Pokémon** or **Favorites** in the picker to change the source. **Trainer mode** limits new companions to caught species and the Kanto starters in both Party and Pokémon Sidebar. **Open legendary Pokémon** lifts the legendary restriction. Orca saves these preferences across sessions. The picker and world share bundled sprites and a bounded offline cache. See the [catalog guide](./catalog/README.md) for cache limits and sprite credits.

Waiting for input pauses the current job. Done pays by active time and rounds each job independently. A job with at least 30 active minutes earns a Rare Candy. Quick answers build friendship and extended waits can reduce it. Evolution follows the species' jobs, friendship, time of day, or item requirements.

The worker tracks agent status across workspaces, including folders, while the panel is closed. It saves the purse, party, in-flight jobs, and trainer records together. It can resume the saved run after a restart when it receives another live status event. The host has no durable replay for status changes the worker missed.

Open **Pokémon Sidebar** to browse workspaces, focus terminals, and see agent cards with their saved Pokémon. See [Pokémon Sidebar](./sidebar/README.md) for the direct-open command and host requirements.

See [Trainer integration](./trainer-integration.md) for the worker contracts and remaining cross-feature wiring.

In Orca’s command palette, use **Choose a Pokémon companion** or **Open Pokémon Bag**.
The default shortcuts are `Alt+Shift+P` and `Alt+Shift+B`. Change them in Orca’s keyboard shortcut settings.
The picker uses the active terminal’s companion when Herd can verify it. Otherwise it asks you to choose a companion from the workspace.

## Credits

Adapted from [Pokerdr](https://github.com/lntvan166/herdr-pokemon/tree/11f949d). The tree and flowers come from its scenery. Its copyright notice is included in LICENSE-upstream.

The Walk, Idle and Sleep sheets for Bulbasaur, Charmander, Squirtle and Pikachu come from [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab/tree/ced880d7598b9d505a267dbed5d05482197b05ff/sprite). The four sprite credit records name CHUNSOFT. This port crops and repacks one direction of each animation. Pokerdr identifies the collection as [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Pokémon and its characters belong to their respective owners.

The battle move choreography and type palettes in `panel/encounters/fx*.js` come from the same Pokerdr revision. Orca adapts its battle drawing to Canvas 2D and uses Pokerdr’s synthesized battle sounds.
