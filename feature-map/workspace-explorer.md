# Workspace Explorer

Users manage files in the active chat's workspace from the Files tree, filename search results and Changes list, using the same filesystem operations and permissions across desktop and mobile.
Git supplies change status by default; explicit captured comparisons retain the originating chat.

## Sub-features

- `quiet-row-menu`: file size and status marker show at rest; the trailing menu replaces it on hover or keyboard focus without adding reserved button width; touch devices retain a tappable menu.
- `adaptive-viewer`: the button immediately before the open file path toggles Explorer and remembers the choice at every panel width, including phones; before the first explicit choice, desktop widths of at least 720px show it automatically.
- `explorer-resize`: Explorer retains its resizable width (180px minimum), while narrow splits keep at least 240px for the viewer and allow horizontal overflow; toggling preserves the file editor and Explorer state.

- `create`: create a file or folder with a name dialog; existing destinations produce an error.
- `organize`: rename, move, duplicate, cut, copy and paste files or folders, with explicit overwrite selection.
- `selection`: Shift-click selects the inclusive visible range from the retained anchor and Ctrl/Cmd-click toggles the clicked entry; modified clicks never expand folders, and the anchor survives opening a preview; clicking empty Explorer space clears the selection and anchor; More file actions → Select files… enables explicit checkbox/tap selection on touch, and Done selecting or Escape exits.
- `folder-status`: direct folder letters require explicit directory comparison evidence; descendant colors prioritize modified, added, then deleted, with mixed counts in the shared tooltip.
- `row-controls`: retain file size and a compact trailing three-dot menu with right-click actions; no hover checkbox/download/copy cluster reserves space.
- `transfer`: upload files or directory structures and download folders or selected entries as ZIP, with shared [notification center](notifications.md) progress and cancellation.
- `recovery`: move selected entries to recoverable trash and restore them without overwriting newer files.
- `navigation`: collapse folders, browse the selected root and search within a folder.
- `compact-toolbar`: narrow Explorer columns keep folder navigation, comparison and the menu visible; folder actions remain in the menu, and host-served status sits below the control row.
- `freshness`: update active directory listings after operations and external changes, including idle-host refresh.
- `stable-refresh`: preserve expanded folders, loaded children and selection while background requests update existing directory queries.
- `git-status`: show current Git status from the nearest repository for explicitly browsed directories, including nested repositories and repositories with a Git directory or Git file.
- `comparison`: Files and Changes keep independent comparison choices; filter and hidden-file controls remain beside the filename field.
- `existing-files`: Files lists existing paths for every comparison without reconstructing missing historical paths; deletions remain reviewable from Changes.
- `scope`: host, root, browse location and open files belong to the selected [independent workspace](workbench-workspaces.md), while agent comparisons name their source chat.
- `states`: empty folders, unavailable host, permission denial, conflicting destinations, partial failures and cancelled transfers retain actionable feedback.

## How to get to it (user POV)

- Desktop web and desktop app: open Workspace → Files for the tree or Changes for the changed-file list; filename search uses the Files search field.
- Point at an entry or focus it with the keyboard to reveal its menu in place of the size; touch users can tap the trailing menu directly.
- Combined path/header: Up, current folder, comparison, New file, New folder, Refresh, Search folder contents, Collapse all folders, More file actions.
- Files and Changes each expose their comparison dropdown in the path row; filter and dot-file toggles stay beside quick search.
- Changes lists Git deletions for review; file comparisons use the shared [workspace diffs](workspace-diffs.md) viewer.
- Rows: right-click a file/folder for its actions; use the row action menu on touch devices.
- Keyboard: arrows and Home/End move through visible rows; F2 renames; Delete moves selections to trash; Ctrl/Cmd+C, X and V copy, cut and paste.
- Drag-and-drop: move selected entries onto a folder, hold the copy modifier to copy, or drop files/directories from the local computer to upload them.
- The shared dashed drop outline keeps folder targets visible, highlights a hovered folder and names the move/copy/upload destination; dropping onto a file uses its containing folder.
- Drop feedback uses the same dashed overlay as chat; the hovered destination folder is highlighted beneath it.
- Mobile web and native shell: Workspace → Files or Changes opens the shared Explorer in a drawer.
- Notifications in the conversation header, Files/Changes drawer or mobile full-screen file viewer opens shared transfer activity after its popup collapses.
- Search in folder opens the shared [workspace content search](workspace-content-search.md) with the chosen scope.

- Open-file header: Show file explorer / Hide file explorer, immediately left of the path, works at every panel width and remembers the choice across files and reloads; drag their divider or use its arrow keys to adjust the Explorer width.

## Driving it with the repro environment

Preconditions: follow the [verification skill](skills/verify-omnigent/SKILL.md), use a session with a writable filesystem and an online runner or host, and use only temporary test files.

- Hover/focus size replacement without row movement: `tests/e2e_ui/files/test_workbench_ownership.py::test_explorer_size_and_menu_share_space_on_hover_and_focus`.

- Real SPA/server/runner file operations, binary upload, ZIP download and restore: `tests/e2e_ui/files/test_explorer_file_operations.py::test_explorer_manages_files_transfers_and_recovery`.
- Delayed background refresh, shared drop overlay, idle/hover row controls and selection visibility: `tests/e2e_ui/files/test_explorer_file_operations.py::test_explorer_background_refresh_and_shared_hover_controls`.
- Transfer progress and cancellation remain accessible through the [notification center](notifications.md) across folder, file and session navigation; real browser navigation during upload is covered by `tests/e2e_ui/files/test_explorer_file_operations.py::test_upload_continues_while_viewing_another_file`, including popup, retained-center and phone-center variants.
- Desktop and mobile toolbar search, replacement preview, apply and undo: `tests/e2e_ui/files/test_explorer_file_operations.py::test_workspace_search_replace_preview_and_undo`.
- Header-toggle persistence across narrow desktop and phone widths: `tests/e2e_ui/files/test_explorer_git_tracking.py::test_file_header_toggles_explorer_at_any_width_and_remembers_choice`.
- Adaptive Explorer/viewer layout, draggable remembered width, 48px control headers, file navigation and resize continuity: `tests/e2e_ui/files/test_explorer_git_tracking.py::test_wide_workspace_keeps_explorer_beside_stable_file_viewer`; `web/src/shell/AdaptiveFileWorkspace.test.tsx` covers draft and focus preservation.
- Filename search and directory reveal: `tests/e2e_ui/files/test_file_search.py`.
- Desktop and phone More file actions → the shared comparison dropdown, nested repository status, retained parent status during delayed discovery, absent historical paths and reload persistence: `tests/e2e_ui/files/test_explorer_git_tracking.py::test_shared_comparison_keeps_files_live_and_gates_mixed_revisions`.
- The same browser scenario checks Git deletions in Changes on desktop; on a phone, close Files, choose Workspace → Changes and open a deleted text file for review as a separate manual check.
- Select different comparison modes in Files and Changes, switch between them and reload; each view should retain its choice and Files should never reconstruct a removed path.
- Folder direct/descendant distinction, mixed counts and color ordering: `web/src/shell/fileStatusUtils.test.ts` and `web/src/shell/FolderTree.test.tsx`.
- Nearest-repository discovery, explicit directory scopes, Git-file worktrees, nested repository boundaries and current status are covered by `tests/test_workspace_git.py`.
- Overlay preferences and live tree behavior have component coverage in `web/src/lib/filesPanelPreferences.test.ts`, `web/src/shell/FilesPanel.test.tsx` and `web/src/shell/FolderTree.test.tsx`.
- Expanded-directory invalidation: `web/src/store/chatStore.test.ts`.
- Open tab reconciliation after folder moves/deletions: `web/src/lib/workspaceFileEvents.test.ts`.
- Modified-click range selection, Ctrl toggle and folder expansion suppression across preview creation: `tests/e2e_ui/files/test_workbench_ownership.py::test_explorer_modified_clicks_select_ranges_without_opening_folders`.
- Keyboard rename, bulk ZIP selection, drag auto-expansion/move, external expanded-folder updates: `tests/e2e_ui/files/test_explorer_file_operations.py::test_explorer_keyboard_bulk_drag_reveal_and_external_refresh`.
- Collapsed/expanded folder moves, modifier-copy, nested external upload and retained failure notifications, both in Files and beside an open preview: `tests/e2e_ui/files/test_explorer_file_operations.py::test_explorer_drop_into_collapsed_and_expanded_folders`.
- For keyboard, bulk selection and drag-and-drop, create two folders and three files; select adjacent and nonadjacent rows, copy/paste into another folder, rename using F2, and drop onto a collapsed folder to check auto-expansion.
- Upload a directory containing a nested binary file and an empty folder; verify both structure and downloaded bytes, then cancel an in-progress transfer and confirm the unfinished destination was not installed.
- Open a file, return to Files and confirm its ancestors remain expanded; press Collapse all folders and confirm expansion clears.
- Modify a temporary expanded folder outside the UI while it is visible and confirm the listing updates; repeat with an idle runner and connected host.
- Exercise denied permissions, existing destination errors and offline failures; verify that they do not appear as successful operations.

## Gotchas

- Independent workspace selection applies to the main right panel; legacy session endpoints remain available for existing authorized session-resource consumers.
- Git discovery considers at most 128 explicitly browsed directories and deduplicates their nearest repositories; it does not recursively scan home for repositories or claim coverage of unopened repositories.
- A nested repository owns status for its subtree, whether its Git metadata is a directory or a Git file.
- Files and Changes default to Git and retain separate selections; opening a file retains the originating comparison scope.
- Missing historical paths are absent from Files, including deleted Git paths; use Changes to review deletions.
- Agent history can be incomplete or stale and must not be read as current Git status; unavailable Git status is an error rather than a successful empty result.
- Filename search searches names and paths; content search and replacement use the separate search surface.
- Uploading a chat attachment does not choose a destination in the Explorer.
- Files inside the workspace require edit permission for mutations; host-absolute paths require owner permission.
- Internal recovery and transfer files are implementation state and cannot be edited through Explorer operations.
- Copy and ZIP preserve symbolic links as links without reading their targets; file operations do not traverse symbolic-link parent directories.
- Cross-filesystem moves stage and verify a copy before removing the source; changes during the move or cleanup failures report the retained destination explicitly.
- Uploads are bounded to 1 GiB per file; ZIP input is bounded to 1 GiB and 50,000 entries, and browser downloads assemble the received chunks in memory.
- Background transfers survive in-app navigation; reloading or closing the browser ends its transfer controller, and later transfers clean stale staging data on the host.
- Transfer popups collapse after their initial countdown without cancelling the operation; chunk updates stay in the notification center, and completion or failure reveals a fresh result.
- Browser folder pickers cannot represent completely empty directories; external directory drops preserve them.
- A lost response to a mutation can mean the operation completed; refresh before retrying.
- Component and API checks do not prove a native mobile wrapper, filesystem sandbox or browser transport that was not exercised.
