# Workspace Explorer

Users manage files on the selected session's host or sandbox from the Files tree, filename search results and Changes list, using the same filesystem operations and permissions across desktop and mobile.
Git supplies change status by default, while an optional agent-change overlay exposes the session's observed edit history.

## Sub-features

- `create`: create a file or folder with a name dialog; existing destinations produce an error.
- `organize`: rename, move, duplicate, cut, copy and paste files or folders, with explicit overwrite selection.
- `selection`: Ctrl/Cmd-click and Shift-click select entries for bulk operations; keyboard navigation and shortcuts operate on tree rows.
- `row-controls`: show only size at rest; hover or keyboard focus reveals checkbox, download, copy and menu in one trailing column; selecting a checkbox keeps the other checkboxes visible.
- `transfer`: upload files or directory structures and download folders or selected entries as ZIP, with shared [notification center](notifications.md) progress and cancellation.
- `recovery`: move selected entries to recoverable trash and restore them without overwriting newer files.
- `navigation`: collapse folders, reveal the most recently active file and search within a folder.
- `freshness`: update active directory listings after operations and external changes, including idle-host refresh.
- `stable-refresh`: preserve expanded folders, loaded children and selection while background requests update existing directory queries.
- `git-status`: show current Git status from the nearest repository for explicitly browsed directories, including nested repositories and repositories with a Git directory or Git file.
- `agent-overlay`: enable Show agent changes from More file actions; the preference is global in this browser, persists across reloads and defaults to off.
- `existing-files`: with the agent overlay off, Files lists existing paths without reconstructing missing historical paths; Git deletions remain reviewable from Changes.
- `scope`: host, default root, remembered browse location and open file tabs still belong to the selected session; browsing elsewhere does not create an independent workspace.
- `states`: empty folders, unavailable host, permission denial, conflicting destinations, partial failures and cancelled transfers retain actionable feedback.

## How to get to it (user POV)

- Desktop web and desktop app: open Workspace → Files for the tree or Changes for the changed-file list; filename search uses the Files search field.
- Toolbar: New file, New folder, Upload, Search folder contents, Collapse all folders, Reveal active file and More file actions.
- More file actions → Show agent changes toggles the optional session overlay in both the desktop rail and phone Files/Changes drawer.
- Changes lists Git deletions for review; file comparisons use the shared [workspace diffs](workspace-diffs.md) viewer.
- Rows: right-click a file/folder for its actions; use the row action menu on touch devices.
- Keyboard: arrows and Home/End move through visible rows; F2 renames; Delete moves selections to trash; Ctrl/Cmd+C, X and V copy, cut and paste.
- Drag-and-drop: move selected entries onto a folder, hold the copy modifier to copy, or drop files/directories from the local computer to upload them.
- Drop feedback uses the same dashed overlay as chat; the hovered destination folder is highlighted beneath it.
- Mobile web and native shell: Workspace → Files or Changes opens the shared Explorer in a drawer.
- Notifications in the conversation header, Files/Changes drawer or mobile full-screen file viewer opens shared transfer activity after its popup collapses.
- Search in folder opens the shared [workspace content search](workspace-content-search.md) with the chosen scope.

## Driving it with the repro environment

Preconditions: follow the [verification skill](skills/verify-omnigent/SKILL.md), use a session with a writable filesystem and an online runner or host, and use only temporary test files.

- Real SPA/server/runner file operations, binary upload, ZIP download and restore: `tests/e2e_ui/files/test_explorer_file_operations.py::test_explorer_manages_files_transfers_and_recovery`.
- Delayed background refresh, shared drop overlay, idle/hover row controls and selection visibility: `tests/e2e_ui/files/test_explorer_file_operations.py::test_explorer_background_refresh_and_shared_hover_controls`.
- Transfer progress and cancellation remain accessible through the [notification center](notifications.md) across folder, file and session navigation; real browser navigation during upload is covered by `tests/e2e_ui/files/test_explorer_file_operations.py::test_upload_continues_while_viewing_another_file`, including popup, retained-center and phone-center variants.
- Desktop and mobile toolbar search, replacement preview, apply and undo: `tests/e2e_ui/files/test_explorer_file_operations.py::test_workspace_search_replace_preview_and_undo`.
- Filename search and directory reveal: `tests/e2e_ui/files/test_file_search.py`.
- Desktop and phone More file actions → Show agent changes, nested repository status, retained parent status during delayed discovery, absent historical paths and reload persistence: `tests/e2e_ui/files/test_explorer_git_tracking.py::test_git_tracking_ignores_agent_ghosts_and_persists_toggle`.
- The same browser scenario checks Git deletions in Changes on desktop; on a phone, close Files, choose Workspace → Changes and open a deleted text file for review as a separate manual check.
- For the overlay check, expand a nested repository under the session root, verify current Git markers with Show agent changes off, enable the checkbox to reveal retained agent history, disable it to remove absent historical paths and reload to confirm the preference remains off.
- Nearest-repository discovery, explicit directory scopes, Git-file worktrees, nested repository boundaries and current status are covered by `tests/test_workspace_git.py`.
- Overlay preferences and live tree behavior have component coverage in `web/src/lib/filesPanelPreferences.test.ts`, `web/src/shell/FilesPanel.test.tsx` and `web/src/shell/FolderTree.test.tsx`.
- Expanded-directory invalidation: `web/src/store/chatStore.test.ts`.
- Open tab reconciliation after folder moves/deletions: `web/src/lib/workspaceFileEvents.test.ts`.
- Keyboard rename, bulk ZIP selection, drag auto-expansion/move, active-file reveal and external expanded-folder updates: `tests/e2e_ui/files/test_explorer_file_operations.py::test_explorer_keyboard_bulk_drag_reveal_and_external_refresh`.
- For keyboard, bulk selection and drag-and-drop, create two folders and three files; select adjacent and nonadjacent rows, copy/paste into another folder, rename using F2, and drop onto a collapsed folder to check auto-expansion.
- Upload a directory containing a nested binary file and an empty folder; verify both structure and downloaded bytes, then cancel an in-progress transfer and confirm the unfinished destination was not installed.
- Open a file, return to Files, press Reveal active file and confirm its ancestors expand and the row scrolls into view; press Collapse all folders and confirm expansion clears.
- Modify a temporary expanded folder outside the UI while it is visible and confirm the listing updates; repeat with an idle runner and connected host.
- Exercise denied permissions, existing destination errors and offline failures; verify that they do not appear as successful operations.

## Gotchas

- This Explorer remains attached to the selected chat's host, default workspace root, browse location and open file tabs; this change does not provide an independent host/workspace chooser.
- Git discovery considers at most 128 explicitly browsed directories and deduplicates their nearest repositories; it does not recursively scan home for repositories or claim coverage of unopened repositories.
- A nested repository owns status for its subtree, whether its Git metadata is a directory or a Git file.
- Show agent changes defaults to off and is independent of the viewer's comparison selector; selecting an agent comparison does not enable the Explorer overlay.
- Missing historical paths are absent from Files when the overlay is off, including deleted Git paths; use Changes to review Git deletions.
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
