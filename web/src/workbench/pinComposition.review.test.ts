import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { terminalLayoutGeometry } from "@/lib/terminalSplitLayout";
import {
  addDockView,
  createDockLayout,
  dockPaneForView,
  filterDockLayout,
  parseDockLayout,
  type DockLayout,
  type DockView,
} from "./dockLayout";
import {
  composeDockLayout,
  createDockPersistence,
  dockStorageKey,
  navigateDockConversation,
  parseDockPersistence,
  pinDockView,
  unpinDockView,
} from "./dockPersistence";
import { useDockLayout, type DockStorage } from "./useDockLayout";

afterEach(cleanup);

const scope = { accountId: "account", serverId: "server", clientId: "client" };
const conversation: DockView = {
  id: "conversation:A",
  kind: "conversation",
  title: "A",
  resource: { conversationId: "A" },
};
const explorer: DockView = {
  id: "explorer",
  kind: "files",
  title: "Explorer",
  resource: { hostId: "host-a", path: "/original" },
};

function memoryStorage(): DockStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

function initialLayout() {
  return addDockView(createDockLayout([conversation]), explorer, { edge: "right" });
}

function rectangle(layout: DockLayout, viewId: string) {
  const pane = dockPaneForView(layout, viewId)!;
  const { key: _key, ...rect } = terminalLayoutGeometry(layout.tree!).panes.find(
    (item) => item.key === pane.id,
  )!;
  return rect;
}

describe("pin-frame review regressions", () => {
  it("shows late restored views immediately, after B/A navigation and after reload", async () => {
    const storage = memoryStorage();
    const layout = initialLayout();
    const { result, unmount } = renderHook(() =>
      useDockLayout({ scope, storage, initialLayout: layout }),
    );
    act(() => result.current.pinView(explorer.id));
    const pinnedRectangle = rectangle(result.current.layout, explorer.id);
    const late: DockView = {
      id: "late",
      kind: "editor",
      title: "Late restored file",
      resource: { hostId: "host-a", path: "/original/late.md" },
    };
    act(() => result.current.restoreConversationViews("A", [late], { edge: "right" }));

    const saved = parseDockPersistence(storage.getItem(dockStorageKey(scope))!)!;
    expect(saved.chats.find((chat) => chat.conversationId === "A")!.layout.views).toContainEqual(
      late,
    );
    expect(result.current.retainedViews).toContainEqual(late);
    expect(result.current.layout.views).toContainEqual(late);
    expect(rectangle(result.current.layout, explorer.id)).toEqual(pinnedRectangle);

    await act(async () => {
      expect(await result.current.navigateConversation("B")).toBe(true);
    });
    expect(result.current.layout.views).not.toContainEqual(late);
    await act(async () => {
      expect(await result.current.navigateConversation("A")).toBe(true);
    });
    expect(result.current.layout.views).toContainEqual(late);
    expect(rectangle(result.current.layout, explorer.id)).toEqual(pinnedRectangle);

    const restored = result.current.layout;
    unmount();
    const reloaded = renderHook(() => useDockLayout({ scope, storage, initialLayout: layout }));
    expect(reloaded.result.current.error).toBeNull();
    expect(reloaded.result.current.layout).toEqual(restored);
  });

  it("keeps the empty slot and exact geometry when the last pin is unpinned after switching", () => {
    let layout = initialLayout();
    layout = addDockView(
      layout,
      { ...explorer, id: "other" },
      { paneId: dockPaneForView(layout, explorer.id)!.id, edge: "bottom" },
    );
    let state = pinDockView(createDockPersistence(layout), explorer.id);
    state = navigateDockConversation(state, "B");
    const before = composeDockLayout(state);
    const emptyPane = before.panes.find((pane) => !pane.viewIds.length)!;
    expect(emptyPane).toBeDefined();
    expect(rectangle(before, explorer.id)).toEqual({ left: 50, top: 0, width: 50, height: 50 });

    state = unpinDockView(state, explorer.id);
    const after = composeDockLayout(state);
    expect(state.pins.views).toEqual([]);
    expect(rectangle(after, explorer.id)).toEqual(rectangle(before, explorer.id));
    expect(after.tree).toEqual(before.tree);
    expect(after.panes).toContainEqual(emptyPane);
    expect(after.views.find((view) => view.id === explorer.id)).toEqual(explorer);
    expect(parseDockLayout(after)).toEqual(after);
    const reloaded = parseDockPersistence(JSON.stringify(state))!;
    expect(composeDockLayout(reloaded)).toEqual(after);
  });

  it.each(["ghost view", "conflicting resource", "missing pin"])(
    "rejects an independently valid saved pin frame containing a %s",
    (corruption) => {
      const state = pinDockView(createDockPersistence(initialLayout()), explorer.id);
      expect(parseDockPersistence(JSON.stringify(state))).toEqual(state);
      let frame = state.pinFrame!;
      if (corruption === "ghost view") {
        frame = createDockLayout([{ ...explorer, id: "alien" }]);
      } else if (corruption === "conflicting resource") {
        frame = {
          ...frame,
          views: frame.views.map((view) =>
            view.id === explorer.id ? { ...view, resource: { path: "/different" } } : view,
          ),
        };
      } else {
        frame = filterDockLayout(frame, (view) => view.id !== explorer.id);
      }
      expect(parseDockLayout(frame)).toEqual(frame);
      expect(parseDockPersistence(JSON.stringify({ ...state, pinFrame: frame }))).toBeUndefined();
    },
  );
});
