# Independent workspaces

The right panel selects a filesystem workspace independently of the chat; Files, Search, Git, PRs and manual terminals use that workspace's authorized execution target, while Activity follows the conversation.

## Sub-features

- `identity`: an owned workspace has a durable target, generation and root; identical paths on different targets remain distinct.
- `selection`: chat switching retains the chosen workspace, file tabs, editor, browse location and search; Open chat workspace changes the target explicitly.
- `authorization`: owning or viewing a chat does not grant ownership of its workspace; host/account and generation checks apply to resource access.
- `routing`: host workspaces use host resources directly, while a runner-only environment retains its original target and reports unavailability rather than reading a different host filesystem.
- `manual-terminals`: user shells belong to the workspace and survive closing a chat; exited history and disconnected state remain distinct.
- `states`: disconnected or revoked workspaces retain their identity and report unavailable access; they do not silently become the current chat's files.

## How to get to it (user POV)

- Keyboard: Ctrl+B toggles the left sidebar, Ctrl+I toggles the right panel, and Ctrl+J opens an existing manual shell or creates one; macOS uses Command.
- Desktop: open the right panel and use Select workspace in its existing top row; choose a known workspace or a folder on an available host.
- Phone: open the right sidebar and use Select workspace beside its tool tabs.
- Switch chats from the left sidebar while keeping a file, search or shell open; the workspace stays selected and a different chat workspace has an explicit Open action.
- Open a file citation in another chat to navigate to its originating workspace after any unsaved-file guard.
- Open a manual shell from the right panel's + menu or mobile Shells list; use Activity for shells and commands used by a chat.

## Driving it with the repro environment

Preconditions: use the isolated [verification environment](skills/verify-omnigent/SKILL.md), a real isolated host and temporary folders; no live inference is required.

- SPA chat switching, editor identity and target-correct CRUD: `tests/e2e_ui/files/test_workbench_ownership.py::test_spa_chat_switch_keeps_editor_and_crud_on_selected_workspace`.
- Visible quick controls, independent comparison preferences and reload: `tests/e2e_ui/files/test_workbench_ownership.py::test_workspace_restores_search_and_hidden_controls_without_coupling_comparisons`.
- Browser terminal attachment and independent lifetime: `tests/e2e_ui/files/test_workbench_ownership.py::test_browser_manual_shell_keeps_workspace_owner_after_chat_deletion`.
- Existing Explorer and search/replace operations over the selected host: `tests/e2e_ui/files/test_workbench_host_resources.py::test_host_workspace_explorer_and_replacement`.
- Workspace persistence, permissions, target identity and provider dispatch: `tests/server/routes/test_workbench_workspaces.py` and `tests/db/test_migration_workbench_workspaces.py`.
- Actual host/tmux lifetime and retained exit output: `tests/server/integration/test_workbench_terminal_host.py::test_host_manual_terminal_survives_chat_delete_and_retains_exit`.
- Terminal cache races, workspace selection and editor transport: `web/src/hooks/useWorkbenchTerminals.test.tsx`, `web/src/hooks/useWorkbenchSelection.test.tsx` and `web/src/lib/workbenchWorkspace.test.tsx`.

## Gotchas

- This filesystem workspace is distinct from an Omnigent deployment's tenant/workspace ID and from a project label.
- The initial independent resource API is owner-scoped; existing shared-chat resource access remains on its authorized compatibility path.
- Runner-only environments require their original live environment; independence of identity does not make suspended or destroyed compute available.
- Selecting a different workspace does not move an existing process or isolate two agents editing the same worktree.
- A normal host disconnect preserves shell evidence; graceful host-daemon shutdown stops its shells, and an abrupt restart reports unknown state where process continuity cannot be established.
- Native iOS/Android wrappers need separate device acceptance; the web UI can be exercised at phone widths without rebuilding those wrappers.
