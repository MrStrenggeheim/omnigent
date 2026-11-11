import { useEffect, useState } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DockWorkspace, type DockWorkspaceProps } from "./DockWorkspace";
import {
  addDockView,
  createDockLayout,
  dockPaneForView,
  moveDockView,
  resizeDockSplit,
  selectDockView,
  type DockLayout,
  type DockView,
} from "./dockLayout";
import { dockStorageKey } from "./dockPersistence";
import { useDockLayout, type DockStorage } from "./useDockLayout";

const view = (id: string, kind = "editor"): DockView => ({
  id,
  kind,
  title: id,
  resource: { scope: "host-a", path: `/${id}` },
});
const scope = { accountId: "account", serverId: "server", clientId: "client" };

function memoryStorage(): DockStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("DockWorkspace resource mounts", () => {
  it("preserves the actual editor DOM, component state, focus and selection through moves, split resize and mobile transitions", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Editor({ id }: { id: string }) {
      const [draft, setDraft] = useState("");
      useEffect(() => {
        mounted(id);
        return () => unmounted(id);
      }, [id]);
      return (
        <input
          aria-label={`Draft ${id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
    }
    let layout = createDockLayout([view("a"), view("b")]);
    const renderView: DockWorkspaceProps["renderView"] = (item, state) => (
      <div data-visible={state.visible} data-resource={item.id}>
        <Editor id={item.id} />
      </div>
    );
    const props = { onLayoutChange: vi.fn(), renderView };
    const rendered = render(<DockWorkspace {...props} layout={layout} />);
    const input = screen.getByLabelText("Draft a") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "unsaved content" } });
    input.focus();
    input.setSelectionRange(2, 7);
    const checkIdentity = () => {
      expect(screen.getByLabelText("Draft a")).toBe(input);
      expect(input.value).toBe("unsaved content");
      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(7);
      expect(mounted).toHaveBeenCalledTimes(2);
      expect(unmounted).not.toHaveBeenCalled();
    };
    layout = moveDockView(layout, "a", { paneId: "main", edge: "right" });
    rendered.rerender(<DockWorkspace {...props} layout={layout} />);
    checkIdentity();
    expect(document.activeElement).toBe(input);
    layout = resizeDockSplit(layout, [], 0.7);
    rendered.rerender(<DockWorkspace {...props} layout={layout} />);
    checkIdentity();
    layout = moveDockView(layout, "a", { paneId: "main", index: 0 });
    rendered.rerender(<DockWorkspace {...props} layout={layout} compact />);
    checkIdentity();
    layout = selectDockView(layout, "b");
    rendered.rerender(<DockWorkspace {...props} layout={layout} compact />);
    expect(input.closest("[data-dock-view]")).toHaveAttribute("hidden");
    expect(input.closest("[data-dock-view]")).toHaveAttribute("inert");
    layout = selectDockView(layout, "a");
    rendered.rerender(<DockWorkspace {...props} layout={layout} compact={false} />);
    checkIdentity();
    expect(input.closest("[data-dock-view]")).not.toHaveAttribute("inert");
  });

  it("retains inactive saved views and reports visibility/focus independently, but resets at scope boundaries", () => {
    const mounted = vi.fn();
    function Resource({ id }: { id: string }) {
      useEffect(() => {
        mounted(id);
      }, [id]);
      return <span>{id} resource</span>;
    }
    const a = view("a");
    const b = view("b");
    const renderView: DockWorkspaceProps["renderView"] = (item, state) => (
      <div
        data-testid={`visibility-${item.id}`}
        data-visible={state.visible}
        data-focused={state.focused}
      >
        <Resource id={item.id} />
      </div>
    );
    const props = { renderView, retainedViews: [a, b], onLayoutChange: vi.fn() };
    const rendered = render(
      <DockWorkspace {...props} scopeKey="account-a" layout={createDockLayout([a])} />,
    );
    const original = screen.getByText("a resource");
    rendered.rerender(
      <DockWorkspace {...props} scopeKey="account-a" layout={createDockLayout([b])} />,
    );
    expect(screen.getByTestId("visibility-a")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("visibility-a")).toHaveAttribute("data-focused", "false");
    rendered.rerender(
      <DockWorkspace {...props} scopeKey="account-a" layout={createDockLayout([a])} />,
    );
    expect(screen.getByText("a resource")).toBe(original);
    expect(mounted).toHaveBeenCalledTimes(2);
    rendered.rerender(
      <DockWorkspace {...props} scopeKey="account-b" layout={createDockLayout([a])} />,
    );
    expect(screen.getByText("a resource")).not.toBe(original);
    expect(mounted).toHaveBeenCalledTimes(4);
  });

  it("offers every pane on mobile and preserves selected tabs in unfocused panes", async () => {
    const user = userEvent.setup();
    const initial = addDockView(createDockLayout([view("a"), view("b")]), view("c"), {
      edge: "right",
    });
    function Workspace() {
      const [layout, setLayout] = useState(initial);
      return (
        <DockWorkspace
          layout={layout}
          onLayoutChange={setLayout}
          compact
          renderView={(item, state) => (
            <div data-testid={item.id} data-visible={state.visible}>
              {item.title} content
            </div>
          )}
        />
      );
    }
    render(<Workspace />);
    expect(screen.queryByRole("combobox", { name: "Open views" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getByTestId("c")).toHaveAttribute("data-visible", "true");
    await user.click(screen.getByRole("tab", { name: "b" }));
    expect(screen.getByTestId("c")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("b")).toHaveAttribute("data-visible", "true");
    expect(screen.getByRole("tab", { name: "b" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "c" })).toHaveAttribute("aria-selected", "false");
    await user.click(screen.getByRole("tab", { name: "c" }));
    expect(screen.getByTestId("c")).toHaveAttribute("data-visible", "true");
    expect(screen.getByRole("tab", { name: "b" })).toHaveAttribute("aria-selected", "false");
    expect(document.querySelectorAll('.dock-pane[data-focused="true"]')).toHaveLength(1);
    expect(screen.queryByRole("separator", { name: "Resize panes" })).not.toBeInTheDocument();
  });

  it("reorders, splits and resizes through keyboard-accessible controls without remounting a resource", async () => {
    const user = userEvent.setup();
    let current: DockLayout = createDockLayout([view("a"), view("b")]);
    function Workspace() {
      const [layout, setLayout] = useState(current);
      current = layout;
      return (
        <DockWorkspace
          layout={layout}
          onLayoutChange={setLayout}
          renderView={(item) => <input aria-label={`Resource ${item.id}`} />}
        />
      );
    }
    render(<Workspace />);
    const resource = screen.getByLabelText("Resource a");
    fireEvent.keyDown(screen.getByRole("tab", { name: "a" }), { key: "ArrowRight", altKey: true });
    expect(current.panes[0].viewIds).toEqual(["b", "a"]);
    await user.click(
      within(screen.getByRole("tab", { name: "a" }).closest("section")!).getByRole("button", {
        name: "Pane actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Split right" }));
    expect(current.panes).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize panes" }), {
      key: "ArrowRight",
    });
    expect(current.tree).toMatchObject({ ratio: 0.55 });
    expect(screen.getByLabelText("Resource a")).toBe(resource);
    await user.click(
      within(screen.getByRole("tab", { name: "a" }).closest("section")!).getByRole("button", {
        name: "Pane actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move to b" }));
    expect(current.panes).toHaveLength(1);
    expect(screen.getByLabelText("Resource a")).toBe(resource);
  });

  it("routes a real pointer drag onto another tab and preserves the resource node", async () => {
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const left = this.getAttribute("role") === "tab" && this.textContent === "b" ? 100 : 0;
        return new DOMRect(left, 0, this.getAttribute("role") === "tab" ? 100 : 800, 48);
      });
    let current = createDockLayout([view("a"), view("b")]);
    function Workspace() {
      const [layout, setLayout] = useState(current);
      current = layout;
      return (
        <DockWorkspace
          layout={layout}
          onLayoutChange={setLayout}
          renderView={(item) => <input aria-label={`Drag ${item.id}`} />}
        />
      );
    }
    try {
      render(<Workspace />);
      const resource = screen.getByLabelText("Drag a");
      fireEvent.pointerDown(screen.getByRole("tab", { name: "a" }), {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      });
      fireEvent.pointerMove(document, { pointerId: 1, isPrimary: true, clientX: 40, clientY: 20 });
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "a" })).toHaveAttribute("data-dragging", "true"),
      );
      fireEvent.pointerMove(document, { pointerId: 1, isPrimary: true, clientX: 150, clientY: 20 });
      fireEvent.pointerUp(document, { pointerId: 1, isPrimary: true, clientX: 150, clientY: 20 });
      expect(current.panes[0].viewIds).toEqual(["b", "a"]);
      expect(screen.getByLabelText("Drag a")).toBe(resource);
      // dnd-kit suppresses document clicks for 50ms after pointer release.
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 60);
        });
      });
    } finally {
      bounds.mockRestore();
    }
  });

  it("guards close asynchronously, prevents duplicate requests, reports errors and preserves moved targets", async () => {
    let decision = deferred<boolean>();
    const guard = vi.fn(() => decision.promise);
    let current = createDockLayout([view("a"), view("b")]);
    const change = vi.fn((update: Parameters<DockWorkspaceProps["onLayoutChange"]>[0]) => {
      current = typeof update === "function" ? update(current) : update;
    });
    const props = {
      onLayoutChange: change,
      onBeforeClose: guard,
      renderView: (item: DockView) => <span>{item.id} content</span>,
    };
    const rendered = render(<DockWorkspace {...props} layout={current} />);
    fireEvent.click(screen.getByRole("button", { name: "Close a" }));
    fireEvent.click(screen.getByRole("button", { name: "Close a" }));
    expect(guard).toHaveBeenCalledTimes(1);
    await act(async () => decision.resolve(false));
    expect(current.views).toHaveLength(2);
    decision = deferred<boolean>();
    fireEvent.click(screen.getByRole("button", { name: "Close a" }));
    await act(async () => decision.reject(new Error("Save failed")));
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
    expect(current.views).toHaveLength(2);
    decision = deferred<boolean>();
    fireEvent.click(screen.getByRole("button", { name: "Close a" }));
    current = moveDockView(current, "a", { paneId: "main", edge: "right" });
    rendered.rerender(<DockWorkspace {...props} layout={current} />);
    await act(async () => decision.resolve(true));
    expect(current.views.map((item) => item.id)).toEqual(["b"]);
  });

  it("does not close a replacement resource when an old guard resolves", async () => {
    const decision = deferred<boolean>();
    let current = createDockLayout([view("a")]);
    const change = (update: Parameters<DockWorkspaceProps["onLayoutChange"]>[0]) => {
      current = typeof update === "function" ? update(current) : update;
    };
    const props = {
      onLayoutChange: change,
      onBeforeClose: () => decision.promise,
      renderView: (item: DockView) => <span>{item.title}</span>,
    };
    const rendered = render(<DockWorkspace {...props} layout={current} />);
    fireEvent.click(screen.getByRole("button", { name: "Close a" }));
    current = createDockLayout([{ ...view("a"), resource: { path: "/replacement" } }]);
    rendered.rerender(<DockWorkspace {...props} layout={current} />);
    await act(async () => decision.resolve(true));
    expect(current.views[0].resource.path).toBe("/replacement");
  });
});

describe("useDockLayout", () => {
  it("persists splits, selection, focus and explicit chat saves; shared navigation does not delete them", async () => {
    const storage = memoryStorage();
    const initialLayout = createDockLayout([view("shared")]);
    const { result, unmount } = renderHook(() => useDockLayout({ scope, storage, initialLayout }));
    act(() => result.current.saveChatLayout("A"));
    act(() => result.current.addView(view("diff"), { edge: "right" }));
    act(() => result.current.setLayout((layout) => resizeDockSplit(layout, [], 0.65)));
    const a = result.current.layout;
    await act(async () => {
      expect(await result.current.navigateConversation("B")).toBe(true);
    });
    expect(result.current.layout.views.map((item) => item.id)).toEqual(["shared"]);
    expect(result.current.hasChatLayout).toBe(false);
    act(() => result.current.addView(view("explorer")));
    act(() => result.current.pinView("explorer"));
    await act(async () => {
      await result.current.navigateConversation("A");
    });
    expect(result.current.layout.views.map((item) => item.id)).toEqual([
      "shared",
      "diff",
      "explorer",
    ]);
    expect(result.current.layout.tree).toMatchObject({ children: [a.tree, expect.any(String)] });
    act(() => result.current.focusView("explorer"));
    const restored = result.current.layout;
    unmount();
    const reloaded = renderHook(() => useDockLayout({ scope, storage, initialLayout }));
    expect(reloaded.result.current.layout).toEqual(restored);
    await act(async () => {
      expect(await reloaded.result.current.useSharedLayout()).toBe(true);
    });
    expect(reloaded.result.current.layout.views.map((item) => item.id)).toEqual([
      "shared",
      "explorer",
    ]);
    await act(async () => {
      await reloaded.result.current.navigateConversation("A");
    });
    expect(reloaded.result.current.layout.views.map((item) => item.id)).toEqual([
      "shared",
      "diff",
      "explorer",
    ]);
  });

  it("keeps actual instances mounted through A/B/A when the hook is wired to DockWorkspace", async () => {
    const mounted = vi.fn();
    let dock!: ReturnType<typeof useDockLayout>;
    function Resource({ id }: { id: string }) {
      useEffect(() => {
        mounted(id);
      }, [id]);
      return <input aria-label={`Saved ${id}`} />;
    }
    function Workspace() {
      dock = useDockLayout({
        scope,
        storage: null,
        initialLayout: createDockLayout([view("shared")]),
      });
      return (
        <DockWorkspace
          layout={dock.layout}
          onLayoutChange={dock.setLayout}
          retainedViews={dock.retainedViews}
          scopeKey={dock.scopeKey}
          onCloseView={dock.closeView}
          renderView={(item) => <Resource id={item.id} />}
        />
      );
    }
    render(<Workspace />);
    act(() => {
      dock.saveChatLayout("A");
      dock.addView(view("diff"), { edge: "right" });
    });
    const diff = screen.getByLabelText("Saved diff") as HTMLInputElement;
    fireEvent.change(diff, { target: { value: "draft" } });
    await act(async () => {
      await dock.navigateConversation("B");
    });
    expect(diff.closest("[data-dock-view]")).toHaveAttribute("hidden");
    act(() => {
      dock.addView(view("explorer"));
      dock.pinView("explorer");
    });
    const explorer = screen.getByLabelText("Saved explorer");
    await act(async () => {
      await dock.navigateConversation("A");
    });
    expect(screen.getByLabelText("Saved diff")).toBe(diff);
    expect(diff.value).toBe("draft");
    expect(screen.getByLabelText("Saved explorer")).toBe(explorer);
    expect(mounted.mock.calls.map(([id]) => id)).toEqual(["shared", "diff", "explorer"]);
  });

  it("isolates accounts/servers/clients and cancels pending actions after a scope change", async () => {
    const storage = memoryStorage();
    const decision = deferred<boolean>();
    const initialLayout = createDockLayout([view("a")]);
    const { result, rerender } = renderHook(
      ({ accountId, serverId, clientId }) =>
        useDockLayout({
          scope: { accountId, serverId, clientId },
          storage,
          initialLayout,
          onBeforeClose: () => decision.promise,
        }),
      { initialProps: scope },
    );
    act(() => result.current.addView(view("only-first")));
    let close!: Promise<boolean>;
    act(() => {
      close = result.current.closeView("a");
    });
    rerender({ ...scope, accountId: "other" });
    expect(result.current.retainedViews.map((item) => item.id)).toEqual(["a"]);
    await act(async () => {
      decision.resolve(true);
      expect(await close).toBe(false);
    });
    expect(result.current.layout.views).toHaveLength(1);
    act(() => result.current.addView(view("only-other")));
    rerender({ ...scope, serverId: "other-server" });
    expect(result.current.layout.views.map((item) => item.id)).toEqual(["a"]);
    rerender({ ...scope, clientId: "other-client" });
    expect(result.current.layout.views.map((item) => item.id)).toEqual(["a"]);
    rerender(scope);
    expect(result.current.layout.views.map((item) => item.id)).toEqual(["a", "only-first"]);
  });

  it("applies a guarded root change after another pane receives focus", async () => {
    const decision = deferred<boolean>();
    const { result } = renderHook(() =>
      useDockLayout({
        scope,
        storage: null,
        initialLayout: createDockLayout([view("a"), view("b")]),
        onBeforeClose: () => decision.promise,
      }),
    );
    let update!: Promise<boolean>;
    act(() => {
      update = result.current.updateView("a", { resource: { path: "/new-root" } });
      result.current.focusView("b");
    });
    await act(async () => {
      decision.resolve(true);
      expect(await update).toBe(true);
    });
    expect(result.current.layout.views.find((item) => item.id === "a")?.resource.path).toBe(
      "/new-root",
    );
    expect(result.current.layout.panes[0].selectedViewId).toBe("b");
  });

  it("guards resource replacements and layout navigation, without guarding focus or docking", async () => {
    const guard = vi.fn(async () => false);
    const { result } = renderHook(() =>
      useDockLayout({
        scope,
        storage: null,
        initialLayout: createDockLayout([view("a")]),
        onBeforeClose: guard,
      }),
    );
    act(() => result.current.saveChatLayout("A"));
    act(() => result.current.addView(view("dirty"), { edge: "right" }));
    act(() => result.current.focusView("a"));
    expect(guard).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.navigateConversation("B")).toBe(false);
    });
    expect(result.current.activeConversationId).toBe("A");
    await act(async () => {
      expect(await result.current.updateView("a", { title: "Renamed" })).toBe(true);
    });
    expect(result.current.layout.views.find((item) => item.id === "a")?.title).toBe("Renamed");
    await act(async () => {
      expect(await result.current.updateView("a", { resource: { path: "/new" } })).toBe(false);
    });
    expect(result.current.layout.views.find((item) => item.id === "a")?.resource.path).toBe("/a");
    guard.mockResolvedValue(true);
    await act(async () => {
      expect(await result.current.updateView("a", { resource: { path: "/new" } })).toBe(true);
    });
    expect(result.current.retainedViews.find((item) => item.id === "a")?.resource.path).toBe(
      "/new",
    );
    await act(async () => {
      expect(await result.current.closeView("dirty")).toBe(true);
    });
    expect(dockPaneForView(result.current.layout, "dirty")).toBeUndefined();
  });

  it("does not let stale navigation discard newer layout edits", async () => {
    const decision = deferred<boolean>();
    const { result } = renderHook(() =>
      useDockLayout({
        scope,
        storage: null,
        initialLayout: createDockLayout([view("a")]),
        onBeforeClose: () => decision.promise,
      }),
    );
    act(() => {
      result.current.saveChatLayout("A");
      result.current.addView(view("dirty"));
    });
    let navigation!: Promise<boolean>;
    act(() => {
      navigation = result.current.navigateConversation("B");
    });
    act(() => result.current.addView(view("newer")));
    await act(async () => {
      decision.resolve(true);
      expect(await navigation).toBe(false);
    });
    expect(result.current.activeConversationId).toBe("A");
    expect(result.current.layout.views.map((item) => item.id)).toEqual(["a", "dirty", "newer"]);
  });

  it("reports corrupt storage and quota failures without overwriting on load or losing current state", async () => {
    const setItem = vi.fn((_key: string, _value: string) => {
      throw new Error("Quota exceeded");
    });
    const storage = { getItem: () => "{invalid", setItem };
    const { result } = renderHook(() =>
      useDockLayout({ scope, storage, initialLayout: createDockLayout([view("a")]) }),
    );
    expect(result.current.error?.message).toContain("invalid");
    expect(setItem).not.toHaveBeenCalled();
    act(() => result.current.addView(view("b")));
    expect(result.current.layout.views).toHaveLength(2);
    expect(result.current.error?.message).toBe("Quota exceeded");
    expect(setItem.mock.calls[0][0]).toBe(dockStorageKey(scope));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});
