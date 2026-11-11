# Unified workspace

Conversation and tool views share resizable, dockable panes while keeping their own resources, drafts and process lifecycles.

## Sub-features

- `panes`: split, resize, move and reorder views without remounting their editors or terminal attachments.
- `layouts`: shared arrangements, explicit chat saves and global view pins persist per account, server and browser.
- `resources`: each Explorer, Search, Changes and Preview owns its machine, folder and presentation state.
- `hierarchy`: durable branches preserve their captured fork boundary independently from delegated-agent parentage.
- `communication`: structured attribution distinguishes agent messages from human input and separates acceptance from consumption.
- `references`: whole chats, completed answers, selected messages and quotes enter drafts with stable source snapshots.
- `activity`: retained shell history and the dedicated Activity view expose actual activity; the composer dock is disabled.
- `navigation`: global commands, contextual find, explicit conversation sources and mobile view switching retain existing workflows.
- `appearance`: shared content surfaces, violet tab focus, consistent switches and list density follow `design-system/omnigent/MASTER.md`.
- `migration`: existing conversation, file and shell references remain accessible without starting or stopping resources.

## How to get to it (user POV)

- Use + Open in the application bar to add Explorer, Changes, Search, a manual terminal, Agent CLI, Activity or Automations.
- Drag a tab to a pane edge to split; use its own close button to close it, or the pane menu to move/pin views.
- Use Layout → Save layout for this chat; pin an Explorer in another chat and return to see both arrangements.
- Expand conversations with children to revisit subchats; hover a row for actions, and use its spinner to identify running work.
- Use New subchat in the composer Add menu or `/side` to open a durable child with an unsent draft.
- Type `@` in a composer, or select text and choose Use in chat…, to inspect and insert captured context.
- Use the application search field or Ctrl/Cmd+K for commands; Ctrl/Cmd+F searches the last interacted region.
- Open Activity and choose a Host to reattach independent shells or inspect retained output; choose a Chat for its agents, messages and shell use.
- Use the grouped Host/Chat source picker in Activity or a Preview's Comments control to choose its owner explicitly.
- Use the combined workspace selector in the composer or resource-view toolbar; Host and Path are both directly reachable in its modal.
- Use Up before the Explorer workspace path to make its parent folder the root.
- Opening Settings temporarily reveals desktop navigation; its mobile section chooser stays reachable when navigation is closed.
- Open Settings → Appearance to change the accent or list density.

## Driving it with the repro environment

Preconditions: follow the [verification skill](skills/verify-omnigent/SKILL.md), build the checkout and use an isolated environment or the sealed browser-contract lane.

- Compact composer, mobile tabs, density-aware headers/sidebar padding and single safe-area inset: `tests/browser_ui/chat/test_workspace_selection_design.py::test_mobile_composer_keeps_tabs_and_follows_appearance_density`.
- Approved palette, root confirmation, Settings and Activity sources: `tests/browser_ui/chat/test_workspace_selection_design.py`.
- Combined picker and controlled chat switching: `web/src/shell/WorkspaceSelectionDialog.test.tsx` and `web/src/components/composer/WorkspaceSwitchControl.test.tsx`.
- Host/Chat Activity and temporary Settings navigation: `web/src/workbench/ActivityView.test.tsx` and `web/src/hooks/useSettingsNavigationVisibility.test.tsx`.
- Integrated desktop/mobile shell, drafts, layout controls and commands: `tests/browser_ui/chat/test_unified_workspace.py`.
- Pane movement, retained editor nodes, resizing, scope changes and A/B/A pins: `web/src/workbench/DockWorkspace.test.tsx` and `web/src/workbench/dockLayout.test.ts`.
- Independent file targets and captured writes: `web/src/workbench/ResourceView.test.tsx`.
- Durable composer branching and keyboard resource reuse: `web/src/workbench/durableSubchat.test.ts` and `web/src/workbench/resourceShortcuts.test.ts`.
- Scoped chat actions, initial sends and draft migration: `web/src/workbench/ScopedChatStore.test.tsx`, `web/src/workbench/useScopedInitialPrompt.test.tsx` and `web/src/workbench/conversationDraft.test.ts`.
- Reattachment, explicit stop and retained terminal output: `web/src/workbench/TerminalResourceView.test.tsx` and `web/src/workbench/TerminalInventoryView.test.tsx`.
- Peer presentation and activity: `web/src/components/blocks/PeerMessage.test.tsx`, `web/src/hooks/usePeerMessages.test.tsx` and `web/src/components/composer/ConversationActivityDock.test.tsx`.
- References, quote destinations and authorized snapshots: `web/src/components/composer/ContextReferences.test.tsx` and `tests/stores/test_context_references.py`.
- Hierarchy and native recovery: `tests/stores/test_conversation_store.py`, `tests/server/integration/test_sessions_fork.py` and `tests/runner/test_suppress_recovery_turn.py`.
- Delivery authorization and deduplication: `tests/server/integration/test_session_orchestration.py`.
- Appearance and migration: `web/src/lib/listDensityPreferences.test.tsx`, `web/src/lib/themePalette.test.ts` and `web/src/workbench/legacyLayout.test.ts`.
- Manually open two chats, an Explorer and a Markdown Preview; type distinct drafts, move the tabs, reload and verify every resource and draft remains attached to its original owner.

## Gotchas

- Closing a view preserves its conversation, shell or schedule; explicit Stop/Delete retains its existing permission and confirmation checks.
- Workspace header rows are 36px tall, or 32px in Compact appearance; sidebar padding follows the same density setting.
- Desktop tab/container headers and view headers remain separate even with one tab; mobile reuses scrolling tabs across all panes.
- Type icons live in desktop tabs, and close controls have accessible names without tooltips.
- Narrow composer workspace labels collapse while the full location stays accessible; the mobile bottom safe area is reserved once.
- Neutral hairlines separate viewports; pane focus uses tab fill, never an enclosing accent frame.
- App bar is medium-light accent, sidebar/tab bars pale accent, focused tab medium-light, and view headers/content neutral; primary controls use white foregrounds.
- Tab/disclosure hover feedback changes instantly, and selected entries retain their selected appearance.
- Shell inventory is integrated into Activity; legacy saved inventory views restore there without stopping their processes.
- Chat workspace changes retain execution confirmation/recovery; browsing-view root changes only retarget that view.
- Conversation hover cards and per-row loading/empty-child labels are removed; hierarchy metadata preloads without transcript downloads.
- Global pins preserve visibility and placement, never change the selected machine or follow another chat automatically.
- Shared-chat file access can retain its session-authorized route; a chat grant does not grant general host access.
- Unknown delivery or process state is not successful consumption or a confirmed exit.
- Legacy branches with missing provenance stay unknown; unsupported native recovery fails visibly without deleting readable history.
- Browser contracts and scripted providers do not prove live-provider behavior or physical mobile-wrapper support.
- Canvas and saved conversation grids retain their existing routes; they are not silently converted into new layouts.
- Their legacy shell unit coverage remains in `web/src/shell/AppShell.test.tsx`; default docked routes use the browser journeys above.
