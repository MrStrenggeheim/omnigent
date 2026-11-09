# Chat activity

Activity combines the selected chat's main agent and subagents with recorded shell sessions and command executions, retaining source identity and bounded historical output independently of the live terminal list.

## Sub-features

- `agents`: retain the existing agent tree, graph and navigation within the expanded Activity panel.
- `shells`: live shell sessions open their existing terminal; completed sessions open retained output and exit details.
- `commands`: captured noninteractive commands appear as command executions rather than fabricated interactive terminals.
- `history`: keep ended activity available while the runner is offline and clearly describe partial capture, unknown state and bounded retention.
- `provenance`: descendant activity preserves its source chat and agent; each descendant needs its own existing read permission.
- `filters`: All, Agents and Shells filter the panel; earlier activity is collapsed initially.

## How to get to it (user POV)

- Desktop: select Activity in the right panel; the stored tab ID remains compatible with the former Agents tab.
- Phone: open Workspace and select Activity.
- Expand an agent to inspect its family, filter Shells, open an existing live terminal or inspect past output.
- Return from another chat to see that conversation's activity rather than the selected filesystem workspace's inventory.

## Driving it with the repro environment

Preconditions: use the isolated [verification environment](skills/verify-omnigent/SKILL.md) and temporary terminal sessions; historical coverage depends on recorded tool/lifecycle data.

- Seeded persisted-command projection, retained-output dialog and no terminal attachment: `tests/e2e_ui/agents/test_chat_activity_history.py::test_activity_inspects_recorded_commands_without_attaching_a_terminal`.
- Filters, grouping, existing-agent navigation, live-open identity and retained-output dialogs: `web/src/shell/ChatActivityPanel.test.tsx` and `web/src/hooks/useChatActivity.test.tsx`.
- Lifecycle capture, command versus shell completion and bounded durable history: `tests/terminals/test_activity_history.py`, `tests/runner/test_session_activity.py` and `tests/server/test_session_activity.py`.
- Existing session resource permission gates: `tests/server/routes/test_shell_permission_gate.py`.
- Manually run a command in a shell while leaving the shell open, then end the shell: the command can complete while the shell is still live, and only the shell's actual end supplies its ended state.
- Disconnect the runner and inspect recorded output; verify that disconnection does not invent a successful exit.

## Gotchas

- Activity records usage and provenance; workspace manual terminals remain independently owned resources.
- History retains at most 128 entries per chat and 8 KiB output snapshots; the runner's local capture is also bounded globally.
- Native vendor commands are projected only where persisted tool records provide evidence; missing completion or exit information remains unknown.
- Viewing historical output never launches, resumes or reruns a process.
- Root activity scans at most 32 authorized sessions and does not expose inaccessible descendants.
