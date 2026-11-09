# Independent workspaces

The right panel follows the active chat's workspace; its folder row scopes Files, Changes, Search, PRs and new manual terminals.
Resource identity and terminal lifetime remain independent of chat lifetime.

## Sub-features

- `identity`: an owned workspace has a durable target, generation and root; identical paths on different targets remain distinct.
- `selection`: the active chat determines workspace identity; there is no separate right-panel selector or saved global workspace override.
- `folder`: Files, Changes, desktop/mobile Search and PR operations share the selected folder; each workspace retains its own folder and view state.
- `dirty-files`: a workspace transition asks before discarding unsaved edits; Keep editing returns to the original chat.
- `authorization`: owning or viewing a chat does not grant ownership of its workspace; host/account and generation checks apply to resource access.
- `routing`: host workspaces use host resources directly, while a runner-only environment retains its original target and reports unavailability rather than reading a different host filesystem.
- `manual-terminals`: user shells belong to the workspace and survive closing a chat; exited history and disconnected state remain distinct.
- `states`: disconnected or revoked workspaces retain their identity and report unavailable access; they do not silently become the current chat's files.

## How to get to it (user POV)

- Keyboard: Ctrl+B toggles the left sidebar, Ctrl+I toggles the right panel, and Ctrl+J opens an existing manual shell or creates one; macOS uses Command.
- Desktop or phone: open the right panel; Files and Changes use the chat workspace automatically.
- Browse into a folder in the second row; Changes and Search follow it, and PRs use its repository context.
- Switch chats from the left sidebar; the panel restores the referenced workspace and protects unsaved edits.
- Open a file citation in the active chat; workspace-qualified links must match that chat's workspace.
- Open a manual shell from the right panel's + menu or mobile Shells list; use Activity for shells and commands used by a chat.

## Driving it with the repro environment

Preconditions: use the isolated [verification environment](skills/verify-omnigent/SKILL.md), a real isolated host and temporary folders; no live inference is required.

- SPA chat switching, editor identity and target-correct CRUD: `tests/e2e_ui/files/test_workbench_ownership.py::test_spa_chat_switch_follows_chat_workspace_for_editor_and_crud`.
- Visible quick controls, independent comparison preferences and reload: `tests/e2e_ui/files/test_workbench_ownership.py::test_workspace_restores_search_and_hidden_controls_without_coupling_comparisons`.
- Browser terminal attachment and independent lifetime: `tests/e2e_ui/files/test_workbench_ownership.py::test_browser_manual_shell_keeps_workspace_owner_after_chat_deletion`.
- Existing Explorer and search/replace operations over the selected host: `tests/e2e_ui/files/test_workbench_host_resources.py::test_host_workspace_explorer_and_replacement`.
- Workspace persistence, permissions, target identity and provider dispatch: `tests/server/routes/test_workbench_workspaces.py` and `tests/db/test_migration_workbench_workspaces.py`.
- Actual host/tmux lifetime and retained exit output: `tests/server/integration/test_workbench_terminal_host.py::test_host_manual_terminal_survives_chat_delete_and_retains_exit`.
- Terminal cache races, workspace selection and editor transport: `web/src/hooks/useWorkbenchTerminals.test.tsx`, `web/src/hooks/useWorkbenchSelection.test.tsx` and `web/src/lib/workbenchWorkspace.test.tsx`.

- Desktop/phone folder scope and manual-terminal startup: `tests/e2e_ui/files/test_workbench_ownership.py::test_panel_folder_scopes_files_changes_search_and_pr`.
- Unsaved editor transition: `tests/e2e_ui/files/test_workbench_ownership.py::test_chat_workspace_switch_guards_unsaved_file_edits`.

## Gotchas

- This filesystem workspace is distinct from an Omnigent deployment's tenant/workspace ID and from a project label.
- The initial independent resource API is owner-scoped; existing shared-chat resource access remains on its authorized compatibility path.
- Runner-only environments require their original live environment; independence of identity does not make suspended or destroyed compute available.
- Browsing changes tool scope, not the agent's working directory or any running shell's directory.
- New manual shells start in the selected folder; existing shells remain workspace-owned.
- PR requests, actions, drafts and caches retain their captured folder, avoiding cross-folder results.
- A normal host disconnect preserves shell evidence; graceful host-daemon shutdown stops its shells, and an abrupt restart reports unknown state where process continuity cannot be established.
- Native iOS/Android wrappers need separate device acceptance; the web UI can be exercised at phone widths without rebuilding those wrappers.
