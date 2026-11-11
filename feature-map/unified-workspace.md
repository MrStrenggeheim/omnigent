# Unified workspace

Conversation and tool views share resizable, dockable panes while keeping their own resources, drafts and process lifecycles.

## Sub-features

- `panes`: split, resize, move and reorder views without remounting their editors or terminal attachments.
- `layouts`: shared arrangements, explicit chat saves and global view pins persist per account, server and browser.
- `resources`: each Explorer, Search, Changes and Preview owns its machine, folder and presentation state.
- `hierarchy`: durable branches preserve their captured fork boundary independently from delegated-agent parentage.
- `communication`: structured attribution distinguishes agent messages from human input and separates acceptance from consumption.
- `references`: whole chats, completed answers, selected messages and quotes enter drafts with stable source snapshots.
- `activity`: shared compact rows, retained shell history and a conditional composer dock expose actual activity and attention.
- `navigation`: global commands, contextual find, explicit conversation sources and mobile view switching retain existing workflows.
- `appearance`: violet defaults, a local logo and shared list-density preferences preserve explicit user choices.
- `migration`: existing conversation, file and shell references remain accessible without starting or stopping resources.

## How to get to it (user POV)

- Use Open in the application bar to add Explorer, Changes, Search, a shell, Activity or Automations.
- Drag a tab to a pane edge to split, or use its actions menu to move, pin or close it.
- Use Layout → Save layout for this chat; pin an Explorer in another chat and return to see both arrangements.
- Expand a conversation in navigation to revisit its subchats; use the conversation menu to branch or inspect it.
- Use New subchat in the composer Add menu or `/side` to open a durable child with an unsent draft.
- Type `@` in a composer, or select text and choose Use in chat…, to inspect and insert captured context.
- Use the application search field or Ctrl/Cmd+K for commands; Ctrl/Cmd+F searches the last interacted region.
- Open Existing shells to reattach or inspect retained output; Stop shell is separate from closing its view.
- Use the Activity source control or a Preview's Comments control to choose its conversation explicitly.
- Open Settings → Appearance to change the accent or list density.

## Driving it with the repro environment

Preconditions: follow the [verification skill](skills/verify-omnigent/SKILL.md), build the checkout and use an isolated environment or the sealed browser-contract lane.

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
- Global pins preserve visibility and placement, never change the selected machine or follow another chat automatically.
- Shared-chat file access can retain its session-authorized route; a chat grant does not grant general host access.
- Unknown delivery or process state is not successful consumption or a confirmed exit.
- Legacy branches with missing provenance stay unknown; unsupported native recovery fails visibly without deleting readable history.
- Browser contracts and scripted providers do not prove live-provider behavior or physical mobile-wrapper support.
- Canvas and saved conversation grids retain their existing routes; they are not silently converted into new layouts.
- Their legacy shell unit coverage remains in `web/src/shell/AppShell.test.tsx`; default docked routes use the browser journeys above.
