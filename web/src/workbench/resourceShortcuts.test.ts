import { beforeEach, expect, it, vi } from "vitest";
import { addDockView, createDockLayout, selectDockView, type DockView } from "./dockLayout";
import { createWorkbenchResourceShortcuts } from "./resourceShortcuts";
import type { OpenWorkbenchView } from "./WorkbenchContext";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import { panelFolderKey, setPanelFolder } from "@/lib/panelFolder";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/identity", () => ({ authenticatedFetch: fetch, getCurrentUserId: () => "owner" }));
const first: WorkbenchWorkspace = {
  id: "first",
  root: "/first",
  host_id: "host-first",
  target_kind: "host",
  capabilities: ["terminal"],
  permission_level: 4,
};
const second: WorkbenchWorkspace = {
  ...first,
  id: "second",
  root: "/second",
  host_id: "host-second",
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const shell = (id: string, state = "running") => ({
  id,
  state,
  connectivity: "connected",
  metadata: { terminal_name: "shell", session_key: id, running: state === "running" },
});
const source = (workspace = first): DockView => ({
  id: `source-${workspace.id}`,
  kind: "preview",
  title: "Source",
  resource: { workspace, conversationId: "annotation-only" },
});

function setup(views: DockView[] = [source()]) {
  let layout = createDockLayout(views);
  const openView = vi.fn((request: OpenWorkbenchView, placement?: { paneId?: string }) => {
    layout = addDockView(
      layout,
      {
        id: `opened-${openView.mock.calls.length}`,
        kind: request.kind,
        title: request.title ?? request.kind,
        resource: JSON.parse(JSON.stringify(request)),
      },
      placement,
    );
  });
  const focusView = vi.fn((id: string) => {
    layout = selectDockView(layout, id);
  });
  const shortcuts = createWorkbenchResourceShortcuts({
    getLayout: () => layout,
    openView,
    focusView,
    onTerminalCreated: vi.fn().mockResolvedValue(undefined),
  });
  return {
    shortcuts,
    openView,
    focusView,
    focus: (id: string) => {
      layout = selectDockView(layout, id);
    },
    add: (view: DockView) => {
      layout = addDockView(layout, view, { edge: "right" });
    },
    layout: () => layout,
  };
}

beforeEach(() => {
  fetch.mockReset();
  localStorage.clear();
});

it("focuses the latest matching manual shell, excluding other workspaces and agent terminals", async () => {
  const views: DockView[] = [
    source(),
    {
      id: "older",
      kind: "terminal",
      title: "Older",
      resource: { workspace: first, terminalId: "old" },
    },
    {
      id: "latest",
      kind: "terminal",
      title: "Latest",
      resource: { workspace: first, terminalId: "latest" },
    },
    {
      id: "agent",
      kind: "agent-terminal",
      title: "Agent",
      resource: { workspace: first, conversationId: "annotation-only" },
    },
    {
      id: "wrong",
      kind: "terminal",
      title: "Other workspace",
      resource: { workspace: second, terminalId: "wrong" },
    },
  ];
  const context = setup(views);
  await context.shortcuts.openTerminal();
  await context.shortcuts.openTerminal();
  expect(context.focusView).toHaveBeenLastCalledWith("latest");
  expect(context.openView).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  context.shortcuts.remember(views[1]);
  context.focus("source-first");
  await context.shortcuts.openTerminal();
  expect(context.focusView).toHaveBeenLastCalledWith("older");
});

it("reopens the newest running workspace shell without creating a process", async () => {
  fetch.mockResolvedValue(
    response({
      available: true,
      data: [
        shell("exited", "exited"),
        shell("terminal_codex_main"),
        shell("newest"),
        shell("older"),
      ],
    }),
  );
  const context = setup();
  await context.shortcuts.openTerminal();
  await context.shortcuts.openTerminal();
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/v1/workbench-workspaces/first/terminals");
  expect(context.openView).toHaveBeenCalledOnce();
  expect(context.openView).toHaveBeenCalledWith(
    expect.objectContaining({ workspace: first, terminalId: "newest", terminalOwner: "workspace" }),
    { paneId: "main" },
  );
});

it("coalesces repeated Ctrl+J and never POSTs another shell after the first opens", async () => {
  let resolveInventory!: (value: Response) => void;
  fetch.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? Promise.resolve(response(shell("created")))
      : new Promise<Response>((resolve) => {
          resolveInventory = resolve;
        }),
  );
  const context = setup();
  const pending = context.shortcuts.openTerminal();
  expect(context.shortcuts.openTerminal()).toBe(pending);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  resolveInventory(response({ available: true, data: [] }));
  await pending;
  await context.shortcuts.openTerminal();
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(context.openView).toHaveBeenCalledOnce();
});

it("captures conversation, directory and destination pane once even if focus changes during resolution", async () => {
  const conversation: DockView = {
    id: "chat-a",
    kind: "conversation",
    title: "A",
    resource: { conversationId: "chat-a" },
  };
  const context = setup([conversation]);
  setPanelFolder(panelFolderKey("chat-a", conversation.id)!, "/first/src");
  let resolveWorkspace!: (value: Response) => void;
  fetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/resolve"))
      return new Promise<Response>((resolve) => {
        resolveWorkspace = resolve;
      });
    return Promise.resolve(
      response(init?.method === "POST" ? shell("created") : { available: true, data: [] }),
    );
  });
  const pending = context.shortcuts.openTerminal();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  context.add(source(second));
  resolveWorkspace(response(first));
  await pending;
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/resolve"))).toHaveLength(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ session_id: "chat-a" });
  const create = fetch.mock.calls.find(
    ([url, init]) => url.endsWith("/first/terminals") && init?.method === "POST",
  );
  expect(JSON.parse(create![1].body)).toMatchObject({ cwd: "/first/src" });
  expect(context.openView).toHaveBeenCalledWith(
    expect.objectContaining({ conversationId: "chat-a", workspace: first, path: "/first/src" }),
    { paneId: "main" },
  );
  expect(fetch.mock.calls.some(([url]) => url.includes("/second/"))).toBe(false);
});

it("Ctrl+Alt+T creates a fresh shell each time even when a matching shell is open", async () => {
  let count = 0;
  fetch.mockImplementation(async () => response(shell(`new-${++count}`)));
  const context = setup([
    source(),
    {
      id: "existing",
      kind: "terminal",
      title: "Shell",
      resource: { workspace: first, terminalId: "existing" },
    },
  ]);
  await Promise.all([context.shortcuts.newTerminal(), context.shortcuts.newTerminal()]);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  expect(context.openView).toHaveBeenCalledTimes(2);
  expect(context.focusView).not.toHaveBeenCalled();
});

it("Ctrl+I reuses an Explorer for its explicit workspace without changing its folder", async () => {
  const context = setup([
    source(),
    {
      id: "explorer",
      kind: "files",
      title: "Explorer",
      resource: {
        workspace: first,
        path: "/first/saved",
        conversationId: "another-annotation-chat",
      },
    },
  ]);
  await context.shortcuts.openFiles();
  await context.shortcuts.openFiles();
  expect(context.focusView).toHaveBeenLastCalledWith("explorer");
  expect(context.layout().views.find((view) => view.id === "explorer")?.resource.path).toBe(
    "/first/saved",
  );
  expect(context.openView).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("coalesces Explorer opens while resolving a chat and never borrows a newly focused owner", async () => {
  const context = setup([
    { id: "chat-a", kind: "conversation", title: "A", resource: { conversationId: "chat-a" } },
  ]);
  let resolve!: (value: Response) => void;
  fetch.mockReturnValue(
    new Promise<Response>((done) => {
      resolve = done;
    }),
  );
  const pending = context.shortcuts.openFiles();
  expect(context.shortcuts.openFiles()).toBe(pending);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  context.add(source(second));
  resolve(response(first));
  await pending;
  await context.shortcuts.openFiles();
  expect(context.openView).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ kind: "files", workspace: first, conversationId: "chat-a" }),
    { paneId: "main" },
  );
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([false, "error"])(
  "does not create when inventory is unavailable (%s)",
  async (available) => {
    fetch.mockResolvedValue(
      available === "error"
        ? new Response("Unavailable", { status: 503 })
        : response({ available, data: [] }),
    );
    const context = setup();
    await expect(context.shortcuts.openTerminal()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
    expect(context.openView).not.toHaveBeenCalled();
  },
);

it("an unowned resource requests a location instead of borrowing the last chat", async () => {
  const context = setup([{ id: "unowned", kind: "activity", title: "Unowned", resource: {} }]);
  await context.shortcuts.openTerminal();
  expect(fetch).not.toHaveBeenCalled();
  expect(context.openView).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "terminal", conversationId: undefined, workspace: undefined }),
    { paneId: "main" },
  );
});

it("resolves an explicit workspace ID without substituting its annotation conversation", async () => {
  const context = setup([
    {
      id: "resource",
      kind: "preview",
      title: "Resource",
      resource: { workspaceId: first.id, conversationId: "annotation-only" },
    },
  ]);
  fetch.mockImplementation(async (url: string) =>
    response(url.endsWith("/terminals") ? { available: true, data: [shell("existing")] } : first),
  );
  await context.shortcuts.openTerminal();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/v1/workbench-workspaces/first",
    "/v1/workbench-workspaces/first/terminals",
  ]);
  expect(context.openView).toHaveBeenCalledWith(
    expect.objectContaining({ workspace: first, terminalId: "existing" }),
    { paneId: "main" },
  );
});

it("does not fall back to a chat when an explicitly owned workspace rejects access", async () => {
  const context = setup([
    {
      id: "resource",
      kind: "preview",
      title: "Resource",
      resource: { workspaceId: first.id, conversationId: "annotation-only" },
    },
  ]);
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ detail: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await expect(context.shortcuts.openFiles()).rejects.toThrow();
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/v1/workbench-workspaces/first");
  expect(context.openView).not.toHaveBeenCalled();
});
