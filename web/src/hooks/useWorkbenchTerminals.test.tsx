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
    "preserves a successful %s when an older list request resolves afterward",
    async (operation) => {
      const oldList = deferred<Response>();
      fetchMock.mockImplementation((_path: string, init?: RequestInit) =>
        init?.method ? Promise.resolve(response(resource("created"))) : oldList.promise,
      );
      const { wrapper, client } = cache();
      client.setQueryData(key(workspaceA), [info("existing")]);
      await client.invalidateQueries({ queryKey: key(workspaceA) });
      const { result } = renderHook(
        () => ({
          list: useTerminals("chat", { workspace: workspaceA }),
          create: useCreateTerminal("chat", workspaceA),
          delete: useDeleteTerminal("chat", workspaceA),
        }),
        { wrapper },
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await act(async () => {
        await result.current[operation].mutateAsync(operation === "create" ? "shell" : "existing");
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
});
