import type * as IdentityModule from "@/lib/identity";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/lib/notifications";
import { FileViewerContext } from "@/shell/FileViewerContext";
import { WorkspaceSwitchControl } from "./WorkspaceSwitchControl";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  gate: vi.fn(),
  currentChat: "chat-a",
  hostReason: undefined as string | undefined,
}));
vi.mock("@/lib/identity", async (original) => ({
  ...(await original<typeof IdentityModule>()),
  authenticatedFetch: state.fetch,
}));
vi.mock("@/hooks/useSessionActionRestrictions", () => ({
  useSessionActionRestrictions: () => ({ switchHostDisabledReason: state.hostReason }),
}));
vi.mock("@/shell/SwitchHostDialog", () => ({
  SwitchHostDialog: ({
    initialHostId,
    initialPath,
    onOpenChange,
  }: {
    initialHostId: string;
    initialPath: string;
    onOpenChange: (open: boolean) => void;
  }) => (
    <section
      role="dialog"
      aria-label="Host move confirmation"
      data-testid="mock-host-move"
      data-host={initialHostId}
      data-path={initialPath}
    >
      <button type="button" onClick={() => onOpenChange(false)}>
        Cancel move
      </button>
    </section>
  ),
}));
vi.mock("@/store/chatStore", () => ({
  useChatStore: {
    getState: () => ({ setWorkspaceSwitching: state.gate, conversationId: state.currentChat }),
  },
}));
const initial = {
  host_id: "host",
  workspace: "/work/a",
  runner_id: "old-runner",
  operation: null,
  can_recover: false,
};
const completed = {
  ...initial,
  workspace: "/work/b",
  runner_id: "new-runner",
  operation: {
    id: "operation",
    phase: "completed",
    blocked: false,
    target_workspace: "/work/b",
    previous_workspace: "/work/a",
    error: null,
  },
};
function Location() {
  return <span data-testid="location">{useLocation().search}</span>;
}
function createFileContext(guard?: (apply: () => void, cancel?: () => void) => void) {
  return {
    openFile: vi.fn(),
    beforeWorkspaceChange: guard,
    openGithubTab: vi.fn(),
    isChangedPath: () => false,
    conversationId: "chat-a",
    workspaceRoot: "/work/a",
    workspaceHome: "/work",
  };
}
function mount({
  reason,
  guard,
}: { reason?: string; guard?: (apply: () => void, cancel?: () => void) => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fileContext = createFileContext(guard);
  const content = (sessionId: string) => (
    <MemoryRouter initialEntries={["/c/chat-a?file=draft.md&workspace=old"]}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <FileViewerContext.Provider value={fileContext}>
            <WorkspaceSwitchControl
              sessionId={sessionId}
              hostId="host"
              workspace="/work/a"
              disabledReason={reason}
            />
            <Location />
          </FileViewerContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const rendered = render(content("chat-a"));
  return { client, changeChat: (sessionId: string) => rendered.rerender(content(sessionId)) };
}
beforeEach(() => {
  state.fetch.mockReset();
  state.gate.mockReset();
  state.currentChat = "chat-a";
  state.hostReason = undefined;
  localStorage.clear();
  toast.dismiss();
  state.fetch.mockImplementation(async (url, options) => {
    if (options?.method === "POST" && JSON.parse(options.body).validate_only)
      return new Response(
        JSON.stringify({
          ...initial,
          validated_workspace: JSON.parse(options.body).workspace,
          unchanged: false,
        }),
      );
    if (String(url) === "/v1/hosts")
      return new Response(
        JSON.stringify({
          hosts: [
            { host_id: "host", name: "Current host", status: "online" },
            { host_id: "other", name: "Other host", status: "online" },
          ],
        }),
      );
    if (String(url).endsWith("/workspace"))
      return new Response(
        JSON.stringify(
          options?.method === "POST"
            ? {
                ...completed,
                operation: { ...completed.operation, id: JSON.parse(options.body).request_id },
              }
            : initial,
        ),
      );
    return new Response(JSON.stringify({ data: [] }));
  });
});
afterEach(() => {
  cleanup();
  toast.dismiss();
});
async function choose() {
  fireEvent.click(screen.getByRole("button", { name: "Change workspace: /work/a" }));
  fireEvent.change(await screen.findByDisplayValue("/work/a"), { target: { value: "/work/b" } });
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
}

it("switches the real captured chat binding and refreshes its workspace context", async () => {
  const { client } = mount();
  await choose();
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.some(
        ([, options]) => options?.method === "POST" && !JSON.parse(options.body).validate_only,
      ),
    ).toBe(true),
  );
  const [url, postOptions] = state.fetch.mock.calls.find(
    ([, options]) => options?.method === "POST",
  )!;
  expect(url).toBe("/v1/sessions/chat-a/workspace");
  expect(JSON.parse(postOptions.body)).toMatchObject({
    workspace: "/work/b",
    expected_workspace: "/work/a",
    expected_runner_id: "old-runner",
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(client.getQueryData(["session-workspace", "chat-a"])).toMatchObject({
    workspace: "/work/b",
  });
  expect(state.gate).toHaveBeenCalledWith("chat-a", false);
});

it("waits for the existing dirty-file guard before sending the workspace request", async () => {
  let proceed!: () => void;
  const guard = vi.fn((apply) => {
    proceed = apply;
  });
  mount({ guard });
  await choose();
  await waitFor(() => expect(guard).toHaveBeenCalledOnce());
  expect(
    state.fetch.mock.calls.some(
      ([, options]) => options?.method === "POST" && !JSON.parse(options.body).validate_only,
    ),
  ).toBe(false);
  await act(async () => proceed());
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.some(
        ([, options]) => options?.method === "POST" && !JSON.parse(options.body).validate_only,
      ),
    ).toBe(true),
  );
});

it("does not let an active turn or queued messages start a switch", () => {
  mount({ reason: "Wait for the current turn" });
  expect(screen.getByRole("button", { name: "Change workspace: /work/a" })).toBeDisabled();
});

it("retains the selected folder and displays a failed preflight without clearing the draft URL", async () => {
  state.fetch.mockImplementation(async (url, options) => {
    if (String(url) === "/v1/hosts") return new Response(JSON.stringify({ hosts: [] }));
    if (!String(url).endsWith("/workspace")) return new Response(JSON.stringify({ data: [] }));
    return new Response(
      JSON.stringify(
        options?.method === "POST" ? { detail: "Folder is outside the agent boundary" } : initial,
      ),
      { status: options?.method === "POST" ? 400 : 200 },
    );
  });
  mount();
  await choose();
  expect(await screen.findByRole("alert")).toHaveTextContent("outside the agent boundary");
  expect(screen.getByDisplayValue("/work/b")).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("file=draft.md");
  expect(state.gate).not.toHaveBeenCalledWith("chat-a", true);
});

it("handles a canonical same-folder no-op without leaving sending paused", async () => {
  const normalFetch = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url, options) => {
    if (!String(url).endsWith("/workspace")) return normalFetch(url, options);
    return new Response(
      JSON.stringify(options?.method === "POST" ? { ...initial, unchanged: true } : initial),
    );
  });
  mount();
  await choose();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(state.gate).not.toHaveBeenCalledWith("chat-a", true);
  expect(screen.getByTestId("location")).toHaveTextContent("file=draft.md");
  expect(toast.getHistory().some((entry) => entry.title === "Workspace unchanged")).toBe(true);
});

it("keeps a pending switch on its original chat when the composer is reused after navigation", async () => {
  let finish!: (response: Response) => void;
  const normalFetch = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url, options) => {
    if (!String(url).endsWith("/workspace")) return normalFetch(url, options);
    if (options?.method === "POST" && JSON.parse(options.body).validate_only)
      return new Response(
        JSON.stringify({ ...initial, validated_workspace: "/work/b", unchanged: false }),
      );
    return options?.method === "POST"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : new Response(JSON.stringify(initial));
  });
  const { client, changeChat } = mount();
  await choose();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  state.currentChat = "chat-b";
  changeChat("chat-b");
  const posted = state.fetch.mock.calls.find(
    ([, options]) => options?.method === "POST" && !JSON.parse(options.body).validate_only,
  )!;
  const requestId = JSON.parse(posted[1].body).request_id;
  await act(async () =>
    finish(
      new Response(
        JSON.stringify({ ...completed, operation: { ...completed.operation, id: requestId } }),
      ),
    ),
  );
  expect(screen.getByTestId("location")).toHaveTextContent("file=draft.md");
  expect(state.gate).toHaveBeenCalledWith("chat-a", false);
  expect(state.gate).not.toHaveBeenCalledWith("chat-b", true);
  expect(client.getQueryData(["session-workspace", "chat-b"])).toMatchObject({ operation: null });
});

it("refreshes chat and panel context when a restored pending operation completes after reload", async () => {
  const pending = {
    ...initial,
    operation: { ...completed.operation, phase: "connecting", blocked: true },
  };
  const normalFetch = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url, options) =>
    String(url).endsWith("/workspace")
      ? new Response(JSON.stringify(pending))
      : normalFetch(url, options),
  );
  const { client } = mount();
  await waitFor(() => expect(state.gate).toHaveBeenCalledWith("chat-a", true));
  const refresh = vi.spyOn(client, "invalidateQueries");
  await act(async () => {
    client.setQueryData(["session-workspace", "chat-a"], completed);
  });
  await waitFor(() => expect(state.gate).toHaveBeenLastCalledWith("chat-a", false));
  expect(refresh).toHaveBeenCalledWith({ queryKey: ["chat-workbench-workspace"] });
  expect(refresh).toHaveBeenCalledWith({ queryKey: ["session", "chat-a"] });
});

it("cancels directory validation without later starting a hidden workspace change", async () => {
  let finish!: (response: Response) => void;
  const normalFetch = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url, options) =>
    !String(url).endsWith("/workspace")
      ? normalFetch(url, options)
      : options?.method === "POST"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : new Response(JSON.stringify(initial)),
  );
  mount();
  await choose();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () =>
    finish(
      new Response(
        JSON.stringify({ ...initial, validated_workspace: "/work/b", unchanged: false }),
      ),
    ),
  );
  expect(
    state.fetch.mock.calls.filter(
      ([, options]) => options?.method === "POST" && !JSON.parse(options.body).validate_only,
    ),
  ).toHaveLength(0);
  expect(state.gate).not.toHaveBeenCalledWith("chat-a", true);
});

it("unpauses sending after reconnect confirms a lost request never started a transition", async () => {
  const normalFetch = state.fetch.getMockImplementation()!;
  let disconnected = false;
  state.fetch.mockImplementation(async (url, options) => {
    if (options?.method === "POST" && !JSON.parse(options.body).validate_only) disconnected = true;
    if (disconnected) throw new Error("Network offline");
    return normalFetch(url, options);
  });
  const { client } = mount();
  await choose();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Network offline"));
  expect(state.gate).toHaveBeenLastCalledWith("chat-a", true);
  disconnected = false;
  await act(async () => {
    await client.refetchQueries({ queryKey: ["session-workspace", "chat-a"] });
  });
  await waitFor(() => expect(state.gate).toHaveBeenLastCalledWith("chat-a", false));
});

it("keeps the combined picker and selected path when the dirty-file guard is cancelled", async () => {
  mount({ guard: (_apply, cancel) => cancel?.() });
  await choose();
  await waitFor(() => expect(screen.getByRole("button", { name: "Use workspace" })).toBeEnabled());
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByDisplayValue("/work/b")).toBeVisible();
  expect(
    state.fetch.mock.calls.some(
      ([, options]) => options?.method === "POST" && !JSON.parse(options.body).validate_only,
    ),
  ).toBe(false);
});

it("hands a different host and selected path to the existing move confirmation without applying a same-host switch", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Change workspace: /work/a" }));
  fireEvent.click(await screen.findByRole("button", { name: /Other host/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Current folder path" }), {
    target: { value: "/other/path" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  const confirmation = await screen.findByTestId("mock-host-move");
  expect(confirmation).toHaveAttribute("data-host", "other");
  expect(confirmation).toHaveAttribute("data-path", "/other/path");
  expect(state.fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  fireEvent.click(screen.getByText("Cancel move"));
  expect(screen.getByDisplayValue("/other/path")).toBeVisible();
});

it("keeps session capability restrictions on host switching", async () => {
  state.hostReason = "This agent cannot move between hosts";
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Change workspace: /work/a" }));
  await screen.findByText("This agent cannot move between hosts");
  expect(screen.queryByRole("button", { name: /Other host/ })).toBeNull();
});
