import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RetainedWorkbench } from "./RetainedWorkbench";
import { WorkbenchBindings } from "./WorkbenchBindings";

const state = vi.hoisted(() => ({ notifications: 0, native: 0, browser: 0, mounts: 0 }));
vi.mock("@/hooks/useIdleNotifications", () => ({
  useIdleNotifications: () =>
    useEffect(() => {
      state.notifications++;
      return () => {
        state.notifications--;
      };
    }, []),
}));
vi.mock("@/hooks/useUnseenConversations", () => ({ useSeedReadState: vi.fn() }));
vi.mock("@/hooks/useIOSViewportLock", () => ({ useIOSViewportLock: vi.fn() }));
vi.mock("@/lib/listDensityPreferences", () => ({ useListDensity: vi.fn() }));
vi.mock("@/hooks/useContextualFindHotkey", () => ({ useContextualFindHotkey: vi.fn() }));
vi.mock("@/hooks/useNewSessionHotkey", () => ({ useNewSessionHotkey: vi.fn() }));
vi.mock("@/hooks/useSettingsHotkey", () => ({ useSettingsHotkey: vi.fn() }));
vi.mock("@/hooks/useApproveHotkey", () => ({ useApproveHotkey: vi.fn() }));
vi.mock("@/lib/nativeBridge", () => ({
  supportsBrowser: () => true,
  onNativeSidebarDrag: () => {
    state.native++;
    return () => {
      state.native--;
    };
  },
}));
vi.mock("@/lib/openLinkInApp", () => ({
  onInAppLinkOpen: () => {
    state.browser++;
    return () => {
      state.browser--;
    };
  },
}));
vi.mock("@/lib/browserActionBus", () => ({ onBrowserActionRequest: () => () => {} }));
afterEach(() => {
  cleanup();
  state.mounts = 0;
});
const noop = () => {};
function Editor() {
  const [text, setText] = useState("");
  useEffect(() => {
    state.mounts++;
  }, []);
  return (
    <input
      aria-label="Retained editor"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );
}
it("retains dirty content across Canvas/Grid while global handlers exist only for the active workbench", () => {
  const palette = vi.fn();
  const view = (active: boolean) => (
    <>
      <RetainedWorkbench active={active}>
        <Editor />
        {active && (
          <WorkbenchBindings
            approvalConversationId={null}
            conversations={[]}
            onChatFind={noop}
            onExplorerFind={noop}
            onTogglePalette={palette}
            onSessionSearch={noop}
            onToggleSidebar={noop}
            onOpenFiles={noop}
            onOpenTerminal={noop}
            onNewTerminal={noop}
            onSidebarDrag={noop}
            onOpenBrowser={noop}
          />
        )}
        {active && <p>Workbench outlet</p>}
      </RetainedWorkbench>
      {!active && <p>Legacy outlet</p>}
    </>
  );
  const mounted = render(view(true));
  fireEvent.change(screen.getByLabelText("Retained editor"), {
    target: { value: "unsaved draft" },
  });
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(palette).toHaveBeenCalledTimes(1);
  expect(state).toMatchObject({ notifications: 1, native: 1, browser: 1, mounts: 1 });
  mounted.rerender(view(false));
  expect(screen.getByLabelText("Retained editor").closest("[inert]")).not.toBeNull();
  expect(screen.queryByText("Workbench outlet")).not.toBeInTheDocument();
  expect(screen.getByText("Legacy outlet")).toBeInTheDocument();
  expect(state).toMatchObject({ notifications: 0, native: 0, browser: 0, mounts: 1 });
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(palette).toHaveBeenCalledTimes(1);
  mounted.rerender(view(true));
  expect(screen.getByLabelText("Retained editor")).toHaveValue("unsaved draft");
  expect(state).toMatchObject({ notifications: 1, native: 1, browser: 1, mounts: 1 });
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(palette).toHaveBeenCalledTimes(2);
});

it("routes open-terminal, new-shell and Explorer shortcuts independently and releases ownership on unmount", () => {
  const openTerminal = vi.fn();
  const newTerminal = vi.fn();
  const files = vi.fn();
  const { unmount } = render(
    <WorkbenchBindings
      approvalConversationId={null}
      conversations={[]}
      onChatFind={noop}
      onExplorerFind={noop}
      onTogglePalette={noop}
      onSessionSearch={noop}
      onToggleSidebar={noop}
      onOpenFiles={files}
      onOpenTerminal={openTerminal}
      onNewTerminal={newTerminal}
      onSidebarDrag={noop}
      onOpenBrowser={noop}
    />,
  );
  fireEvent.keyDown(window, { code: "KeyJ", ctrlKey: true });
  expect(openTerminal).toHaveBeenCalledOnce();
  expect(newTerminal).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true, altKey: true });
  expect(newTerminal).toHaveBeenCalledOnce();
  fireEvent.keyDown(window, { code: "KeyI", ctrlKey: true });
  expect(files).toHaveBeenCalledOnce();
  for (const code of ["KeyJ", "KeyT", "KeyI"])
    fireEvent.keyDown(window, { code, ctrlKey: true, altKey: code === "KeyT", repeat: true });
  expect(openTerminal).toHaveBeenCalledOnce();
  expect(newTerminal).toHaveBeenCalledOnce();
  expect(files).toHaveBeenCalledOnce();
  const consumed = new KeyboardEvent("keydown", { code: "KeyJ", ctrlKey: true, cancelable: true });
  consumed.preventDefault();
  window.dispatchEvent(consumed);
  expect(openTerminal).toHaveBeenCalledOnce();
  unmount();
  fireEvent.keyDown(window, { code: "KeyJ", ctrlKey: true });
  fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true, altKey: true });
  expect(openTerminal).toHaveBeenCalledOnce();
  expect(newTerminal).toHaveBeenCalledOnce();
});
