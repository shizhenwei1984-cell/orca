# Pokémon Herd for Orca

Open **Pokémon Herd** in the desktop right sidebar. In **World**, each linked terminal agent in the current workspace gets a Pokémon. It walks while working, stands alert while waiting or blocked, and rests when done. Click a companion or press Enter on it to pet it and return to its terminal. Press P on a focused companion to pet it without leaving the panel. Friendship rewards have a cooldown.

Open **World actions** or right-click the ground for the Box, Bag, Shop, Research, Pokédex, and encounter controls. Press B or Alt+Shift+B while the world has focus to open the Bag. Right-click a companion, press Shift+F10 while it has focus, or touch and hold to open its actions. Use this menu to feed a Berry, see its details, bring out a Pokémon from the Box, or open the species picker. Alt+Shift+P opens the picker for the focused companion.

Open **Settings** to change scenery, weather, the campfire, or the visitor rate. You can turn off outbreaks, new raids, world sparring, item pickup, and evolution through work. Active raids can finish after you turn off new raids. You can also choose moves manually against trainers. Battle sounds, companion cries, and pet and sparring sounds start muted.

The trainer summary shows Pokédollars, time worked, finished jobs and Rare Candy. Open **Party** to see each companion's work, friendship and evolution progress.

Install the folder with `orca plugin install ./examples/plugins/pokemon-herd`. Review the trusted worker, workspace and agent read access, and plugin storage grants. Orca includes terminal focus in its workspace write grant. The plugin uses that grant to focus the companion's terminal when you activate it. Then run `orca plugin open local.pokemon-herd`.

Open **Trainer** to use the Bag and Shop, browse the Box and Pokédex, or check Research and badges. Use **Care** on a Pokémon's card to pet it, give it an item, rename it, or move it to the Box. In the Box, choose **Put in Day Care** to leave a parent. Compatible parents can lay an egg as your agents work. Hatched Pokémon join the Box and Pokédex.

In the trainer's **Party**, use **Change Pokémon** to find a species or form and preview its appearance. Favorites and the source for new companions are saved across sessions. The picker and world share bundled sprites and a bounded offline cache. See the [catalog guide](./catalog/README.md) for cache limits and sprite credits.

Waiting for input pauses the current job. Done pays by active time and rounds each job independently. A job with at least 30 active minutes earns a Rare Candy. Quick answers build friendship and extended waits can reduce it. Evolution follows the species' jobs, friendship, time of day, or item requirements.

The worker tracks agent status across workspaces, including folders, while the panel is closed. It saves the purse, party, in-flight jobs, and trainer records together. It can resume the saved run after a restart when it receives another live status event. The host has no durable replay for status changes the worker missed.

See [Trainer integration](./trainer-integration.md) for the worker contracts and remaining cross-feature wiring.

## Credits

Adapted from [Pokerdr](https://github.com/lntvan166/herdr-pokemon/tree/11f949d). The tree and flowers come from its scenery. Its copyright notice is included in LICENSE-upstream.

The Walk, Idle and Sleep sheets for Bulbasaur, Charmander, Squirtle and Pikachu come from [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab/tree/ced880d7598b9d505a267dbed5d05482197b05ff/sprite). The four sprite credit records name CHUNSOFT. This port crops and repacks one direction of each animation. Pokerdr identifies the collection as [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Pokémon and its characters belong to their respective owners.
