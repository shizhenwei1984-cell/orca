# Pokémon Herd for Orca

Open **Pokémon Herd** in the desktop right sidebar. Each terminal agent in the focused workspace gets a Pokémon. It walks while working, stands alert while waiting or blocked, and sleeps when done.

Install the folder with `orca plugin install ./examples/plugins/pokemon-herd`. Review the worker, workspace and agent read access, and plugin storage grant. Then run `orca plugin open local.pokemon-herd`.

Open **Trainer** to use the Bag and Shop, browse the Box and Pokédex, or check Research and badges. Use **Care** on a Pokémon's card to pet it, give it an item, rename it, or move it to the Box. In the Box, choose **Put in Day Care** to leave a parent. Compatible parents can lay an egg as your agents work. Hatched Pokémon join the Box and Pokédex.

Waiting for input pauses the current job. Done pays by active time and rounds each job independently. A job with at least 30 active minutes earns a Rare Candy. Quick answers build friendship and extended waits can reduce it. Evolution follows the species' jobs, friendship, time of day, or item requirements.

The worker tracks agent status across workspaces, including folders, while the panel is closed. It saves the purse, party, in-flight jobs, and trainer records together. It can resume the saved run after a restart when it receives another live status event. The host has no durable replay for status changes the worker missed.

See [Trainer integration](./trainer-integration.md) for the worker contracts and remaining cross-feature wiring.

## Credits

Adapted from [Pokerdr](https://github.com/lntvan166/herdr-pokemon/tree/11f949d). The tree and flowers come from its scenery. Its copyright notice is included in LICENSE-upstream.

The Walk, Idle and Sleep sheets for Bulbasaur, Charmander, Squirtle and Pikachu come from [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab/tree/ced880d7598b9d505a267dbed5d05482197b05ff/sprite). The four sprite credit records name CHUNSOFT. This port crops and repacks one direction of each animation. Pokerdr identifies the collection as [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Pokémon and its characters belong to their respective owners.
