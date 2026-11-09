# Workspace diffs

Files, Changes and the file viewer share one explicit comparison with one-word labels (Git, Turn, Chat, Since and Revisions), scoped to the selected panel folder, so displayed badges, changed paths and opened diffs use the same versions.

## Sub-features

- `working-tree`: Git (uncommitted changes) compares each discovered repository's HEAD with current disk, including staged, unstaged and untracked files from all writers.
- `agent-turn`: Turn selects the latest completed captured turn by default, another captured turn by ID, or an explicitly selected in-progress turn.
- `chat`: Chat compares captured agent preimages and postimages across the conversation; it does not read current disk as a substitute for captured agent output.
- `since`: Since compares a selected commit with current disk, including later commits and uncommitted edits.
- `revisions`: Revisions compares two commits, or a single commit with its parent; a root commit has an empty parent side.
- `root-gate`: Since and Revisions stay disabled unless the selected panel folder is itself a Git repository root, including Git-file worktrees; hover, keyboard focus and accessible descriptions explain the requirement.
- `sync`: changing comparison in a panel or viewer updates the shared selection without mixing Git and agent sources.
- `live-tree`: Files remains the live filesystem and only decorates existing entries; Changes includes deletions and groups multiple repositories.
- `coverage`: captured-history limits, missing preimages and interleaved external changes remain explicit; unavailable data never becomes an invented empty file or a Git fallback.
- `comments`: historical and captured agent snapshots suppress anchors into current-file comments; only current-disk comparisons support those anchors.

## How to get to it (user POV)

- In the file viewer, use the three-dot menu → Copy link to file to share the current file and view.

- Desktop: open Workspace → Files or Changes and use Diff comparison in the combined path/control header.
- Phone: use the right sidebar toggle to open Workspace, choose Files or Changes, then open Diff comparison in that panel's path row.
- Any text file viewer: choose Show diff in its toolbar or More actions, then use the same comparison dropdown.
- Turn opens a captured-turn picker; Since and Revisions open revision forms with Compare and Cancel.
- In a mixed-folder scope, navigate the panel path into a repository root to enable revision comparisons.
- A chat file link can open the same viewer; the chosen panel comparison remains the source of its diff.

## Driving it with the repro environment

Preconditions: follow the isolated [verification environment](skills/verify-omnigent/SKILL.md), prepare temporary Git repositories with known commits, and use fresh captured tool turns for provenance checks.

- Desktop and phone live-tree preservation, scoped comparison selection and mixed-root gating: `tests/e2e_ui/files/test_explorer_git_tracking.py::test_shared_comparison_keeps_files_live_and_gates_mixed_revisions`.
- Repository path selection, Since commit, committed ranges and synchronized viewer/list results: `tests/e2e_ui/files/test_explorer_git_tracking.py::test_shared_comparison_selects_repository_revisions`.
- Working-tree and revision status, Git-file worktrees, root commits, bounds and read-only inspection: `tests/test_workspace_git.py` and `tests/runner/test_environment_filesystem.py`.
- Captured turn/session selection, frozen after-images, unknown preimages and bounded storage: `tests/runtime/test_turn_file_baselines.py` and `tests/runtime/test_filesystem_registry.py`.
- Persisted Codex turn patches and selected file extraction: `tests/server/test_agent_file_diff.py`.
- Disabled-mode explanation, revision and turn forms, cancellation, source synchronization and cache separation: `web/src/shell/DiffComparisonControls.test.tsx`, `web/src/lib/workspaceComparison.test.ts`, `web/src/hooks/useWorkspaceComparisons.test.tsx` and `web/src/shell/FileViewer.test.tsx`.
- Historical comment suppression: `web/src/shell/MonacoDiffViewer.test.tsx`.
- Endpoint permission and scope gates: `tests/server/routes/test_shell_permission_gate.py`.
- To check captured agent provenance, change A to B in one supported-tool turn, then edit externally to C; Agent turn must retain A to B and This chat must not silently substitute C as agent output.
- In another captured turn, interleave a manual edit before the agent write and inspect the coverage warning; a before-to-after aggregate does not prove exclusive authorship.
- Run revision comparisons from a nonrepository parent, repository root and repository subfolder; only the repository root enables the revision forms.
- Repeat phone file-link and Changes deletion entry points, and record unavailable native-device prerequisites separately.

## Gotchas

- Panel paths and resources still belong to the selected chat; these comparisons do not implement independent host/workspace ownership.
- A workspace containing several repositories compares uncommitted state separately against each repository's own HEAD; historical hashes cannot be reused across unrelated repositories.
- Discovery follows bounded browsed directories rather than scanning the whole home directory.
- Git comparisons include every writer; a chat-start checkpoint compared with current disk is not exclusive agent attribution.
- Captured history is bounded and may be partial; supported native providers can also supply stored patches instead of complete before/after files.
- User files created and then deleted without a committed or captured baseline should disappear from live Files.
- Historical snapshots cannot safely attach comments at current-file line positions.
- Component and phone-width Chromium results do not establish physical iOS, Android or Electron behavior.
