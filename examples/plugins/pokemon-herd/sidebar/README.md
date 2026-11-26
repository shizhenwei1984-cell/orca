# Pokémon Sidebar in Orca

Open **Pokémon Sidebar** in the right sidebar, or run:

```sh
orca plugin open local.pokemon-herd --panel pokemon-sidebar
```

**Workspaces** groups workspaces by project and host. Select a workspace to switch to it. Select a terminal or agent card to open its workspace and focus that terminal. **Agents** groups live agents by priority, workspace, project, or name prefix. Search by workspace, terminal, or Pokémon name. The Agents view also has a status filter. Pin an agent from its card menu to keep it at the top.

Use **Collapse** to show workspace initials with compact terminal rows, Pokémon portraits, and status dots. The panel also uses the rail when its viewport is narrower than 160 pixels. **View options** can stack both lists, include hidden projects, or hide Orca's right sidebar. Reopen the panel with its right sidebar tab.

The workspace menu can rename a workspace and open a background terminal. For Git projects it can create a worktree with the project's setup policy. Hiding a project changes Orca's project visibility on the named host. Use **Show hidden projects** and **Show project** to restore it. The terminal menu can focus the pane, open a background terminal in that workspace, or close the selected terminal after confirmation when it belongs to the active workspace.

Agent states and elapsed times come from Orca. Cards show saved Pokémon, friendship hearts, held items, and evolution requirements when the trainer save has a companion for that pane. The card menu can open the existing catalog picker for that companion. The latest terminal focused from this panel carries a selection marker while its workspace is active. Native workspace selection updates the workspace marker. **Refresh** reloads workspaces and terminal lists, including changes in inactive workspaces that did not generate an event.

## Workspace access

Open a workspace and choose **Allow workspace access** in the Sidebar. Orca asks for permission for that workspace on its current execution host. Read access covers tab titles, selection, and Git checkout and review status. Enable the separate rename checkbox to rename terminal and chat tabs. Orca’s editor rename moves the underlying file on disk, so Sidebar exposes selection for editor tabs.

The tab list shows the active workspace only and marks its selected tab. Use a tab’s menu to rename that exact tab. Press Shift+F10 or use the context-menu key in the rail. The review badge uses Orca’s review cache and its refresh button asks Orca to refresh that checkout. Review links use Orca’s external-link confirmation. Folder workspaces have no review badge.

Use the workspace menu to change or remove access, or remove it from **Workspace access** on the plugin’s detail page in Settings. Access persists in the current Orca profile. Switching workspaces or hosts clears the projected rows until Orca admits the new view. Older hosts keep terminal and agent navigation.

## Upstream behavior and host requirements

The port follows [Pokémon Sidebar at revision 11f949d](https://github.com/lntvan166/herdr-pokemon/tree/11f949d/mods/pokemon-sidebar), including its `views`, settings schema, and Herd's `better-sidebar-cards.patch` and `better-sidebar-rail.patch`. The upstream license and attribution are in [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

| Upstream behavior                                                                                                              | Orca support or API required                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dock, replace, resize, and independently show sidebar blocks. Preserve the previous width when expanding.                      | The native panel opens directly and can dock on the left, right, or bottom. Orca controls its size. The combined view shows both lists in one panel.                                                                                                       |
| Workspace initials and terminal icons in the rail. Expanded spaces under machines and Git worktrees under their main checkout. | Orca supplies workspace and project IDs, names, branches, and host IDs. Worktree groups use the project ID on that host. Exact main-checkout nesting needs a primary checkout or parent identity in `workspace.list`.                                      |
| Open, rename, create, drag to reorder, or remove a space from Herdr's space menu.                                              | `workspace.open` and `workspace.rename` apply across listed workspace kinds. `workspace.create` creates Git worktrees only. Folder creation, manual reorder, archive, and removal need separate workspace host methods.                                    |
| Checkout badges, pull request state and links, `git.retry_after`, and `pull_request_status`.                                   | The active workspace’s checkout and review badge use the scoped desktop panel API and Orca’s review service.                                                                                                                                               |
| List all tabs and select the focused tab, pin agent cards, fold machine and agent groups.                                      | The scoped list selects terminal, editor, and chat tabs and marks the native selection. Pins and folds still apply to agent and workspace groups. Native next-agent ordering remains separate.                                                             |
| Priority that includes sub-agents, a tree of child agents, terminal peek, and same-folder rival marks.                         | Expanded cards show each reported child’s state and age beneath its parent. The rail summarizes the child count. Orca marks verified same-folder rivals and includes child activity in the parent status. In-process children share the parent’s terminal. |
| Rename tab, new tab, and close tab from the card menu.                                                                         | `terminal.create` and `terminal.close` work on terminal panes, with close limited by the host. The scoped tab menu renames an exact terminal or chat tab using its current handle.                                                                         |
| Choose another Pokémon, open its Box card, and open its items and moves menu.                                                  | The catalog picker uses the trainer worker and the same saved companion. For the active workspace, its menu can open the companion’s Box card or Party care.                                                                                               |
| Settings, Better Config, add machine, update-ready dot, and right panel toggle.                                                | View options include the combined layout and native right sidebar toggle. The other controls require host actions for Settings, plugin settings, connections, and update state.                                                                            |

The host lists at most 500 workspaces and 50 terminal panes and agents per workspace. The panel uses Orca's desktop plugin host. A mobile panel surface would need its own contribution support.
