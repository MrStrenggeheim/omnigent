import { setPanelFolder } from "@/lib/panelFolder";
import { toast } from "@/lib/notifications";
import type * as IdentityModule from "@/lib/identity";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchWorkspaceProvider, type WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import { useSessionRunnerOnline } from "@/hooks/RunnerHealthProvider";
import {
  terminalsQueryKey,
  useCreateTerminal,
  useDeleteTerminal,
  useTerminals,
  type TerminalInfo,
} from "./useTerminals";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/lib/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof IdentityModule>()),
  authenticatedFetch: fetchMock,
}));
vi.mock("@/hooks/RunnerHealthProvider", () => ({ useSessionRunnerOnline: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ toast: { error: vi.fn() } }));

const workspaceA: WorkbenchWorkspace = {
  id: "workspace-a",
  root: "/a",
  host_id: "host-a",
  target_kind: "host",
  capabilities: ["terminals"],
};
const workspaceB: WorkbenchWorkspace = { ...workspaceA, id: "workspace-b", host_id: "host-b" };
const key = (workspace: WorkbenchWorkspace) => ["workbench-terminals", workspace.id];

// Matches server.workbench_terminal_service.terminal_resource, including metadata.
function resource(id: string, workspace = workspaceA, state = "running") {
  const running = state === "running";
  const attachPath = `/v1/workbench-workspaces/${workspace.id}/terminals/${id}/attach`;
  return {
    id,
    type: "terminal",
    name: "bash",
    session: "manual-1",
    running,
    workspace_id: workspace.id,
    state,
    connectivity: "connected",
    attachPath,
    metadata: {
      terminal_name: "bash",
      session_key: "manual-1",
      running,
      state,
      workspace_id: workspace.id,
      attachPath,
      output: "bounded terminal output",
    },
  };
}

function info(id: string, workspace = workspaceA): TerminalInfo {
  return { id, name: "bash", session: "manual-1", running: true, workspaceId: workspace.id };
}

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

const clients: QueryClient[] = [];
function cache() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(useSessionRunnerOnline).mockReturnValue(undefined);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe("workspace terminal queries", () => {
  it("uses the provider's workspace without a chat and maps backend rows while omitting ended tabs", async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [
          resource("live"),
          resource("ended", workspaceA, "exited"),
          resource("stopped", workspaceA, "stopped"),
        ],
      }),
    );
    const { client } = cache();
    const { result } = renderHook(() => useTerminals(null), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <WorkbenchWorkspaceProvider value={workspaceA}>{children}</WorkbenchWorkspaceProvider>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.terminals).toEqual([info("live")]));
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/v1/workbench-workspaces/workspace-a/terminals",
    ]);
    expect(client.getQueryData(terminalsQueryKey("unrelated-chat"))).toBeUndefined();
  });

  it("keeps workspace data when the displayed chat and agent runner health change", async () => {
    fetchMock.mockResolvedValue(response({ data: [resource("live")] }));
    const { wrapper } = cache();
    const { result, rerender } = renderHook(
      ({ chat }) => useTerminals(chat, { workspace: workspaceA }),
      { wrapper, initialProps: { chat: "chat-a" } },
    );
    await waitFor(() => expect(result.current.terminals).toEqual([info("live")]));
    vi.mocked(useSessionRunnerOnline).mockReturnValue(false);
    rerender({ chat: "chat-b" });
    expect(result.current.terminals).toEqual([info("live")]);
    expect(
      fetchMock.mock.calls.every(([path]) => String(path).startsWith("/v1/workbench-workspaces/")),
    ).toBe(true);
  });

  it("isolates a late workspace list response after switching workspaces", async () => {
    const pendingA = deferred<Response>();
    fetchMock.mockImplementation((path: string) =>
      path.includes(workspaceA.id)
        ? pendingA.promise
        : Promise.resolve(response({ data: [resource("b", workspaceB)] })),
    );
    const { wrapper, client } = cache();
    const { result, rerender } = renderHook(
      ({ workspace }) => useTerminals("chat", { workspace }),
      { wrapper, initialProps: { workspace: workspaceA } },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ workspace: workspaceB });
    await waitFor(() => expect(result.current.terminals).toEqual([info("b", workspaceB)]));
    await act(async () => {
      pendingA.resolve(response({ data: [resource("a")] }));
    });
    expect(result.current.terminals).toEqual([info("b", workspaceB)]);
    expect(client.getQueryData(key(workspaceB))).toEqual([info("b", workspaceB)]);
  });

  it("reports a workspace error without trying any session resource endpoint", async () => {
    fetchMock.mockResolvedValue(response({ detail: "Workspace host is offline" }, 503));
    const { wrapper } = cache();
    const { result } = renderHook(() => useTerminals("chat", { workspace: workspaceA }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/workbench-workspaces/workspace-a/terminals");
  });
});

describe("workspace terminal mutations", () => {
  it.each(["create", "delete"] as const)(
    "finishes an asynchronous %s in its original workspace cache after selection changes",
    async (operation) => {
      const pending = deferred<Response>();
      fetchMock.mockReturnValue(pending.promise);
      const { wrapper, client } = cache();
      client.setQueryData(key(workspaceA), [info("shared-id")]);
      client.setQueryData(key(workspaceB), [info("shared-id", workspaceB)]);
      client.setQueryData(terminalsQueryKey("chat-b"), [info("agent")]);
      const { result, rerender } = renderHook(
        ({ workspace, chat }) => ({
          create: useCreateTerminal(chat, workspace),
          delete: useDeleteTerminal(chat, workspace),
        }),
        { wrapper, initialProps: { workspace: workspaceA, chat: "chat-a" } },
      );
      act(() => result.current[operation].mutate(operation === "create" ? "shell" : "shared-id"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0][0]).toBe(
        `/v1/workbench-workspaces/workspace-a/terminals${operation === "delete" ? "/shared-id" : ""}`,
      );
      rerender({ workspace: workspaceB, chat: "chat-b" });
      await act(async () => {
        pending.resolve(response(resource("created")));
      });
      await waitFor(() =>
        expect(client.getQueryData(key(workspaceA))).toEqual(
          operation === "create" ? [info("shared-id"), info("created")] : [],
        ),
      );
      expect(client.getQueryData(key(workspaceB))).toEqual([info("shared-id", workspaceB)]);
      expect(client.getQueryData(terminalsQueryKey("chat-b"))).toEqual([info("agent")]);
    },
  );

  it.each(["create", "delete"] as const)(
    "keeps the original %s target when selection changes while queries are being cancelled",
    async (operation) => {
      const cancelled = deferred<void>();
      fetchMock.mockResolvedValue(response(resource("created")));
      const { wrapper, client } = cache();
      client.setQueryData(key(workspaceA), [info("existing")]);
      client.setQueryData(key(workspaceB), [info("existing", workspaceB)]);
      const cancelQueries = client.cancelQueries.bind(client);
      const cancel = vi.spyOn(client, "cancelQueries").mockImplementationOnce(async (filters) => {
        await cancelQueries(filters);
        await cancelled.promise;
      });
      const { result, rerender } = renderHook(
        ({ workspace }) => ({
          create: useCreateTerminal("chat", workspace),
          delete: useDeleteTerminal("chat", workspace),
        }),
        { wrapper, initialProps: { workspace: workspaceA } },
      );
      act(() => result.current[operation].mutate(operation === "create" ? "shell" : "existing"));
      await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
      expect(fetchMock).not.toHaveBeenCalled();
      rerender({ workspace: workspaceB });
      await act(async () => cancelled.resolve());
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0][0]).toBe(
        `/v1/workbench-workspaces/workspace-a/terminals${operation === "delete" ? "/existing" : ""}`,
      );
      expect(client.getQueryData(key(workspaceA))).toEqual(
        operation === "create" ? [info("existing"), info("created")] : [],
      );
      expect(client.getQueryData(key(workspaceB))).toEqual([info("existing", workspaceB)]);
    },
  );

  it.each([
    ["create", "before"],
    ["delete", "before"],
    ["create", "during"],
    ["delete", "during"],
  ] as const)(
    "preserves a successful %s when a list started %s the mutation resolves afterward",
    async (operation, phase) => {
      const oldList = deferred<Response>();
      const mutation = deferred<Response>();
      fetchMock.mockImplementation((_path: string, init?: RequestInit) =>
        init?.method ? mutation.promise : oldList.promise,
      );
      const { wrapper, client } = cache();
      client.setQueryData(key(workspaceA), [info("existing")]);
      if (phase === "before") await client.invalidateQueries({ queryKey: key(workspaceA) });
      const { result } = renderHook(
        () => ({
          list: useTerminals("chat", { workspace: workspaceA }),
          create: useCreateTerminal("chat", workspaceA),
          delete: useDeleteTerminal("chat", workspaceA),
        }),
        { wrapper },
      );
      if (phase === "before") await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      let pending!: Promise<TerminalInfo | void>;
      act(() => {
        pending = result.current[operation].mutateAsync(
          operation === "create" ? "shell" : "existing",
        );
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(phase === "before" ? 2 : 1));
      if (phase === "during") {
        act(() => {
          void client.refetchQueries({ queryKey: key(workspaceA), exact: true });
        });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      }
      await act(async () => {
        mutation.resolve(response(resource("created")));
        await pending;
      });
      const expected = operation === "create" ? [info("existing"), info("created")] : [];
      expect(client.getQueryData(key(workspaceA))).toEqual(expected);
      await act(async () => {
        oldList.resolve(response({ data: [resource("existing")] }));
      });
      await waitFor(() => expect(result.current.list.isFetching).toBe(false));
      expect(client.getQueryData(key(workspaceA))).toEqual(expected);
    },
  );

  it.each(["exited", "stopped"])(
    "reconciles a timed-out stop as %s in its original workspace without a stale poll restoring the tab",
    async (state) => {
      const stop = deferred<Response>();
      const check = deferred<Response>();
      const staleList = deferred<Response>();
      fetchMock.mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return stop.promise;
        if (path.endsWith("/existing")) return check.promise;
        return staleList.promise;
      });
      const { wrapper, client } = cache();
      client.setQueryData(key(workspaceA), [info("existing")]);
      client.setQueryData(key(workspaceB), [info("existing", workspaceB)]);
      const { result, rerender } = renderHook(
        ({ workspace }) => ({
          delete: useDeleteTerminal("chat", workspace),
          // Another pane can keep this workspace's inventory active after selection changes.
          list: useTerminals(null, { workspace: workspaceA }),
        }),
        { wrapper, initialProps: { workspace: workspaceA } },
      );
      act(() => result.current.delete.mutate("existing"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // A poll can begin after onMutate cancelled the earlier inventory request.
      let poll!: Promise<void>;
      act(() => {
        poll = client.refetchQueries({ queryKey: key(workspaceA), exact: true });
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      rerender({ workspace: workspaceB });
      await act(async () =>
        stop.resolve(response({ detail: "Stop acknowledgment timed out" }, 504)),
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(fetchMock.mock.calls[2][0]).toBe(
        "/v1/workbench-workspaces/workspace-a/terminals/existing",
      );
      await act(async () => check.resolve(response(resource("existing", workspaceA, state))));
      await waitFor(() => expect(client.getQueryData(key(workspaceA))).toEqual([]));
      await act(async () => {
        staleList.resolve(response({ data: [resource("existing")] }));
        await poll;
      });
      expect(client.getQueryData(key(workspaceA))).toEqual([]);
      expect(result.current.list.terminals).toEqual([]);
      expect(client.getQueryData(key(workspaceB))).toEqual([info("existing", workspaceB)]);
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it.each([
    [403, "Workspace is read-only", undefined],
    [503, "Workspace host is offline", "running"],
    [504, "Stop acknowledgment timed out", "unknown"],
  ] as const)(
    "reports the actual %s failure and refreshes only the captured workspace",
    async (status, message, state) => {
      const stop = deferred<Response>();
      fetchMock.mockReturnValueOnce(stop.promise);
      if (state) fetchMock.mockResolvedValueOnce(response(resource("existing", workspaceA, state)));
      const { wrapper, client } = cache();
      client.setQueryData(key(workspaceA), [info("existing")]);
      client.setQueryData(key(workspaceB), [info("existing", workspaceB)]);
      const invalidate = vi.spyOn(client, "invalidateQueries");
      const { result, rerender } = renderHook(
        ({ workspace }) => useDeleteTerminal("chat", workspace),
        { wrapper, initialProps: { workspace: workspaceA } },
      );
      act(() => result.current.mutate("existing"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      rerender({ workspace: workspaceB });
      await act(async () => stop.resolve(response({ detail: message }, status)));
      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
      expect(toast.error).toHaveBeenCalledWith("Could not close the shell", {
        description: `${message} Refresh the shell list to check its state before retrying.`,
      });
      expect(invalidate).toHaveBeenCalledExactlyOnceWith({
        queryKey: key(workspaceA),
        exact: true,
      });
      expect(client.getQueryData(key(workspaceA))).toEqual([info("existing")]);
      expect(client.getQueryData(key(workspaceB))).toEqual([info("existing", workspaceB)]);
      expect(fetchMock).toHaveBeenCalledTimes(state ? 2 : 1);
    },
  );
});

it("starts new manual terminals in the selected panel folder without changing their workspace owner", async () => {
  fetchMock.mockResolvedValue(response(resource("created")));
  const { wrapper } = cache();
  setPanelFolder(workspaceA.id, "/a/nested");
  const { result, unmount } = renderHook(() => useCreateTerminal("chat-a", workspaceA), {
    wrapper,
  });
  act(() => result.current.mutate("shell"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/v1/workbench-workspaces/workspace-a/terminals");
  expect(JSON.parse(options.body)).toMatchObject({ terminal: "shell", cwd: "nested" });
  unmount();
  setPanelFolder(workspaceA.id, null);
});
