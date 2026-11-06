# Workspace content search and replace

Users search file contents across the session workspace or a browsed folder, inspect grouped matches, and preview and apply selected replacements with undo.
Filename search remains a separate control in Files.

## Sub-features

- `search`: search automatically after a short typing pause, or submit with Enter/Search; cancel an active request.
- `options`: match case, whole words, regular expressions, include/exclude globs and readable ignore files.
- `scope`: follow the browsed folder, search a chosen folder or pin the search folder while browsing elsewhere.
- `navigate`: group matches by file, collapse groups and open a match at its exact line and column.
- `replace`: preview one occurrence, a file or checked matches; review before/after text before applying.
- `captures`: expand numeric/named capture groups and optionally preserve matched text case.
- `recovery`: reject stale file snapshots, report per-file failures and undo a replacement without overwriting newer edits.
- `states`: initial, searching, cancelled, no matches, errors, partial results, preview, applied and restored.
- `gate`: enabled by default; a deployment can explicitly disable `workspace_content_search`.
- `host`: use the authorized idle host when the runner is offline.

## How to get to it (user POV)

- Desktop web and desktop app: open a session's Workspace panel and select the **Content search** tab, or choose **Select panel → Content search**.
- Files: use **Search file contents** in the Explorer toolbar or the folder context-menu search action.
- Keyboard: **Cmd+Shift+F** on macOS (**Ctrl+Shift+F** on Windows/Linux) opens content search and focuses the query, including from the editor or terminal.
- Replacement keyboard: **Cmd+Shift+H** on macOS (**Ctrl+Shift+H** on Windows/Linux) opens content search with the replacement field focused.
- Search panel: choose **Replace** to reveal the replacement controls, and **Filter files** for include, exclude, folder and ignore options.
- Mobile: the Files toolbar or folder context menu opens content search in a full-screen drawer with the same search and replacement controls.

## Driving it with the repro environment

Preconditions: use the isolated [verification environment](skills/verify-omnigent/SKILL.md), install `rg` on the runner/host and use a session with filesystem access.
The feature is enabled by default; set `OMNIGENT_FEATURES=-workspace_content_search` only to verify explicit disabling.

Create a UTF-8 file containing two occurrences of a distinctive word on one line and a second file with mixed-case occurrences.
Open content search using each applicable entry point and type the word.
Confirm grouped occurrence counts, highlighted matches, line/column navigation and cancellation.
Toggle case, whole word and regex and confirm results change after the typing pause.
Open Filter files and test comma-separated include/exclude globs with brace alternatives.
Search a chosen folder, pin it, browse elsewhere and confirm the search remains pinned.
Unpin and confirm the browsed folder supplies the search scope.
Switch sessions and return to verify each session's draft and completed results remain separate.

Open Replace, enter replacement text and uncheck one occurrence.
Choose Preview replacements and verify the before/after text appears before any file changes.
Apply, inspect the on-disk result and choose Undo replacement.
Verify a per-file Replace action previews only that file and a row Replace action previews only that occurrence.
For regex, use `name=(\w+)` and replacement `$1=$$value`; verify the selected occurrence becomes `one=$value`.
Edit a file externally after searching and verify replacement reports that the file changed without overwriting it.
Edit a file externally after applying and verify undo preserves the newer edit and reports the conflict.
Verify a read-only collaborator can search only when workspace-file sharing is enabled and cannot replace files.
Disconnect the session runner while leaving its host online and repeat search/replace through the host fallback.
Disable the feature and verify its tab, picker entry and keyboard entry are unavailable.

- Actual SPA/server/runner, Explorer search entry and preview/apply/undo on desktop and mobile: `tests/e2e_ui/files/test_explorer_file_operations.py::test_workspace_search_replace_preview_and_undo`.
- Browser line navigation and preserved results with a mocked API: `tests/browser_ui/files/test_file_line_navigation.py::test_content_search_opens_line_and_preserves_results`.
- Runner search/options/scope: `tests/runner/test_environment_filesystem.py::test_content_search_live_workspace`, `test_content_search_limits_errors_and_hidden_files`, `test_content_search_occurrences_scope_and_ignore_controls` and `test_content_search_process_boundaries` in the same file.
- Runner replacement and recovery: `tests/runner/test_environment_filesystem.py::test_content_replace_preview_apply_undo_and_stale_guard`, `test_content_replace_capture_groups_selection_and_undo_conflict` and `test_content_replace_rejects_symlinks_and_traversal` in the same file.
- Server access, scope and feature gating: `tests/server/routes/test_shell_permission_gate.py`.
- Component drafts, scope, cancellation and replacement lifecycle: `web/src/shell/ContentSearchPanel.test.tsx`; entry points and shortcuts: `web/src/shell/WorkspacePanel.test.tsx`.

## Gotchas

- Files' filename filter searches paths; Content search searches saved text on disk and does not include unsaved editor buffers.
- Relative folder scopes are under the session workspace; absolute scopes require session ownership and matching environment access grants.
- The search is bounded to 500 occurrences and 15 seconds; partial results are labeled and Replace operates only on the displayed selected matches.
- Binary files, symlinks, `.git` and internal `.omnigent-*` recovery/upload files are excluded; disabling ignore files does not expose those internal files.
- Include globs can override normal ignore rules as in ripgrep; Exclude globs take precedence.
- Regex search uses ripgrep; replacement capture expansion accepts compatible Python regex syntax and refuses a match it cannot safely expand.
- Numeric `$1`/`$2`, named `${name}`, literal `$$`, and escaped newline/tab replacements are supported.
- Replacement needs a readable UTF-8 text snapshot of at most 10 MiB per file and 32 MiB across selected files.
- Undo history is private to the actor, session and folder, retained for up to seven days with bounded entry count and size; it is not permanent version history.
- File hashes and final identity/content checks prevent replacing already changed snapshots; they do not lock out arbitrary external writers.
- Cancelling search aborts the browser request; the bounded host search process may finish independently.
- In-flight search and completed results survive panel switching in memory until page reload; submitted searches refresh disk state.
- Older runners/hosts may require an update before supporting the new search or replacement routes.
