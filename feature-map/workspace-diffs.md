# Workspace diffs

Users compare a text file against Git revisions or captured agent edits from the selected session's file viewer, with an explicit comparison selector and clear errors when a baseline is unavailable.

## Sub-features

- `working-tree`: Git working tree compares HEAD with current on-disk contents, including staged and unstaged edits.
- `commit`: Commit compares a selected commit with its first parent; a root commit has a known empty parent side.
- `range`: Commit range compares the supplied Base revision and Target revision without including current index or working-tree edits.
- `last-turn`: Last agent turn shows an actual stored Codex turn summary as a raw patch, or prospective before/after contents captured from supported file tools during the latest started turn.
- `session`: Agent changes · session compares the first observed session baseline with current file contents, preserving an unknown first baseline as unknown.
- `independence`: comparison sources remain available with Show agent changes off, including historical Git comparisons for a currently unchanged text file.
- `comments`: historical commit, range and last-turn comparisons suppress existing line comments and new comment controls; current Git and agent-session comparisons retain normal comment permissions.
- `states`: loading, unchanged content, created/deleted files, invalid revisions, unavailable baselines, binary or oversized contents and failed reads have distinct outcomes without substituting another comparison.
- `scope`: comparisons use the selected session's authorized filesystem and the file's repository or captured session history; they do not select an independent host or workspace.

## How to get to it (user POV)

- Desktop web and desktop app: select a text file in Workspace → Files or Changes, or follow a file link in chat, then choose Show diff in the file viewer toolbar or its More actions menu when the toolbar is collapsed.
- Desktop comparison controls: open Diff comparison and choose Git working tree, Last agent turn, Agent changes · session, Commit or Commit range.
- Commit: enter Commit revision and press Compare; Commit range: enter Base revision and Target revision and press Compare.
- Phone web and native shell: Workspace → Files or Changes opens the drawer; choose a text file to enter the full-screen file viewer, then use Show diff in the toolbar or More actions menu and the same comparison controls.
- A file link in chat can also open the phone file viewer; an existing link requesting a diff opens that viewer's diff mode.
- A captured Codex turn summary is also visible in the chat transcript as its turn-level diff card.

## Driving it with the repro environment

Preconditions: follow the isolated [verification environment](skills/verify-omnigent/SKILL.md), use a session with filesystem access, prepare temporary Git repositories with known commits and use fresh turns when checking prospective capture.

- Desktop viewer and explicit commit selection with the Explorer agent overlay off: `tests/e2e_ui/files/test_explorer_git_tracking.py::test_diff_compares_explicit_commits_with_agent_tracking_off`.
- In that desktop browser scenario, inspect the working-tree comparison, select Commit range and compare two known revisions, then select Commit for the root commit and verify its empty parent side.
- Backend current status, HEAD comparisons, staged/unstaged isolation, revision ranges, root commits, invalid revisions, binary/size bounds and Git-file worktrees: `tests/test_workspace_git.py`.
- Stored Codex patches, file selection, quoted paths, rename-only patches and refusal to reuse a patch from an older turn: `tests/server/test_agent_file_diff.py`.
- Prospective turn/session separation, frozen after-images after external edits, unknown preimages, absent files and memory limits: `tests/runtime/test_turn_file_baselines.py` and `tests/runtime/test_filesystem_registry.py`.
- Runner endpoint capture and the distinction between frozen Last agent turn contents and current Agent changes · session contents: `tests/runner/test_environment_filesystem.py::test_agent_diff_keeps_last_turn_snapshot_and_reads_current_session_content`.
- Selector labels, revision input, source switching, source independence from the Explorer overlay and unavailable-baseline recovery have component coverage in `web/src/shell/DiffComparisonControls.test.tsx`, `web/src/shell/FileViewer.test.tsx` and `web/src/hooks/useFileDiff.test.ts`.
- Historical comment suppression has component coverage in `web/src/shell/MonacoDiffViewer.test.tsx`.
- Phone viewer comparison controls have component coverage; browser verification of phone diff comparisons is still outstanding, so the desktop browser result does not prove this entry point.
- To drive that phone entry point manually, open a temporary text file from Workspace → Files, choose Show diff, exercise all five sources and confirm revision inputs and errors remain usable in the full-screen viewer.
- Repeat from Workspace → Changes with a deleted Git text file and from a chat file link; verify the selected comparison remains explicit and historical views offer no line-comment controls.
- For prospective capture, change A to B in one supported-tool turn, finish that turn, edit the file externally to C and verify Last agent turn still shows A to B while Agent changes · session reads current C.
- For Codex, finish a turn that emits a stored turn diff and select Last agent turn for a file in that patch; verify the raw patch is readable without reconstructing full file contents from its hunks.
- Select an invalid Git revision or a file with no captured agent baseline, verify the error, then switch sources and confirm the selector remains usable.
- These test references describe coverage; record the candidate revision, exercised entry points and remaining gaps for each verification run.

## Gotchas

- Host, default root, browse location and file tabs remain session-bound; Git comparison support does not implement a general explorer with an independent host/workspace chooser.
- Git working tree uses HEAD, while Commit and Commit range compare committed versions; neither historical mode includes unsaved editor buffers or current working-tree edits.
- An empty parent side is valid for a root commit, and an absent side is valid for a known creation or deletion; an unknown revision or uncaptured preimage must not become HEAD or an invented empty file.
- Last agent turn's prospective coverage is limited to observed supported file tools and keeps the latest started turn, including an in-progress turn, rather than relabeling a whole-session snapshot.
- Prospective capture is in memory, retains the current turn and previous turn, and is bounded to 10 MiB per file image and 32 MiB per session across retained images; restart, read failure or a limit can make a baseline unavailable.
- A captured last-turn after-image is read during successful mutation recording and remains frozen when the file changes later; session comparison intentionally reads current contents instead.
- Shell side effects are unknown to supported-tool capture; a stored Codex turn summary can include shell edits reported by Codex, but its live notification is not recovered by resume backfill.
- A Codex raw patch is an observed turn summary, not a reconstructed pair of complete historical files, and a newer turn without a patch must not display an older turn's summary.
- Historical line numbers do not identify current-file comment locations, so historical comparisons suppress comments instead of attaching them to misleading lines.
- Git discovery uses only explicitly browsed directories, capped at 128, and does not recursively scan home for repositories.
- Phone selector component coverage does not establish browser behavior; native iOS, Android and Electron wrapper behavior also requires separate evidence.
