# Pokémon Herd for Orca

Open **Pokémon Herd** in the desktop right sidebar. In **World**, each linked terminal agent in the current workspace gets a Pokémon. It walks while working, stands alert while waiting or blocked, and rests when done. Click a companion or press Enter on it to return to its terminal. Open **Settings** to change the rows, scenery, Pokémon size and sound.

The trainer summary shows Pokédollars, time worked, finished jobs and Rare Candy. Open **Party** to see each companion's work, friendship and evolution progress.

Install the folder with `orca plugin install ./examples/plugins/pokemon-herd`. Review the trusted worker, workspace and agent read access, and plugin storage grants. Orca includes terminal focus in its workspace write grant. The plugin uses that grant to focus the companion's terminal when you activate it. Then run `orca plugin open local.pokemon-herd`.

The worker starts tracking when it receives live agent status. Waiting for input pauses a job. Done completes it and pays by active time, with fractional Pokédollars carried across jobs. A job with at least 30 active minutes earns a Rare Candy. Quick answers build friendship and extended waits can reduce it. Starters that evolve through work need 15 jobs for the first evolution and 30 more for the second. The card shows the current species name beside the starter's artwork.

The worker tracks every workspace, including folders, while the panel is closed. It stores the purse, party and in-flight jobs together under the versioned `trainer` key. `trainer.mjs` owns the state transitions. The panel reads `trainer.read` by terminal ID and refreshes on `trainer.changed`.

## Credits

Adapted from [Pokerdr](https://github.com/lntvan166/herdr-pokemon/tree/11f949d). The tree and flowers come from its scenery. Its copyright notice is included in LICENSE-upstream.

The Walk, Idle and Sleep sheets for Bulbasaur, Charmander, Squirtle and Pikachu come from [PMD SpriteCollab](https://github.com/PMDCollab/SpriteCollab/tree/ced880d7598b9d505a267dbed5d05482197b05ff/sprite). The four sprite credit records name CHUNSOFT. This port crops and repacks one direction of each animation. Pokerdr identifies the collection as [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Pokémon and its characters belong to their respective owners.
