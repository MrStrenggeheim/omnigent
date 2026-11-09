import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkbenchSelection } from "./useWorkbenchSelection";
import { authenticatedFetch } from "@/lib/identity";
import type { WorkbenchWorkspace } from "@/lib/workbenchTypes";

vi.mock("@/lib/identity", () => ({
  authenticatedFetch: vi.fn(),
  getCurrentUserId: () => "owner",
  subscribeIdentity: () => () => {},
}));
const first: WorkbenchWorkspace = {
  id: "first",
  root: "/first",
  host_id: "host-a",
  target_kind: "host",
  capabilities: ["files"],
};
const second: WorkbenchWorkspace = { ...first, id: "second", root: "/second", host_id: "host-b" };
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(authenticatedFetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/resolve")) {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body.session_id === "chat-a" ? first : second));
    }
    if (url.endsWith("/first")) return new Response(JSON.stringify(first));
    if (url.endsWith("/second")) return new Response(JSON.stringify(second));
    if (url === "/v1/workbench-workspaces")
      return new Response(JSON.stringify({ data: [first, second] }));
    return new Response("Missing", { status: 404 });
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

it("follows the chat's workspace and ignores the old globally saved selection", async () => {
  localStorage.setItem("omnigent:workbench-selection:owner", "revoked");
  const view = renderHook(({ session }) => useWorkbenchSelection(session), {
    wrapper: wrapper(),
    initialProps: { session: "chat-a" },
  });
  await waitFor(() => expect(view.result.current.workspace?.id).toBe("first"));
  view.rerender({ session: "chat-b" });
  await waitFor(() => expect(view.result.current.workspace?.id).toBe("second"));
  expect(
    vi.mocked(authenticatedFetch).mock.calls.every(([url]) => String(url).endsWith("/resolve")),
  ).toBe(true);
});

it("does not show another chat's workspace when resolution fails", async () => {
  const view = renderHook(({ session }) => useWorkbenchSelection(session), {
    wrapper: wrapper(),
    initialProps: { session: "chat-a" },
  });
  await waitFor(() => expect(view.result.current.workspace?.id).toBe("first"));
  vi.mocked(authenticatedFetch).mockResolvedValueOnce(new Response("{}", { status: 503 }));
  view.rerender({ session: "chat-b" });
  await waitFor(() => expect(view.result.current.error).toBeTruthy());
  expect(view.result.current.workspace).toBeUndefined();
});

it("ignores a late response from the outgoing chat", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(authenticatedFetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderHook(({ session }) => useWorkbenchSelection(session), {
    wrapper: wrapper(),
    initialProps: { session: "chat-a" },
  });
  view.rerender({ session: "chat-b" });
  await waitFor(() => expect(view.result.current.workspace?.id).toBe("second"));
  await act(async () => finish(new Response(JSON.stringify(first))));
  expect(view.result.current.workspace?.id).toBe("second");
});

it("has no workspace on the new-chat page", async () => {
  const view = renderHook(() => useWorkbenchSelection(undefined), { wrapper: wrapper() });
  expect(view.result.current.workspace).toBeUndefined();
  expect(view.result.current.isLoading).toBe(false);
  expect(authenticatedFetch).not.toHaveBeenCalled();
});

it("keeps the original target until its dirty-file guard accepts the switch", async () => {
  let accept!: () => void;
  const guard = vi.fn((_target, apply) => {
    accept = apply;
  });
  const view = renderHook(({ session }) => useWorkbenchSelection(session, true, guard), {
    wrapper: wrapper(),
    initialProps: { session: "chat-a" },
  });
  await waitFor(() => expect(view.result.current.workspace?.id).toBe("first"));
  view.rerender({ session: "chat-b" });
  await waitFor(() => expect(guard).toHaveBeenCalled());
  expect(view.result.current.workspace?.id).toBe("first");
  expect(view.result.current.sourceSessionId).toBe("chat-a");
  act(() => accept());
  expect(view.result.current.workspace?.id).toBe("second");
  expect(view.result.current.sourceSessionId).toBe("chat-b");
});

it.each([403, 404, 405, 501])(
  "keeps the active chat's authorized legacy resources for metadata HTTP %s",
  async (status) => {
    vi.mocked(authenticatedFetch).mockResolvedValueOnce(new Response("{}", { status }));
    const view = renderHook(() => useWorkbenchSelection("shared-chat"), { wrapper: wrapper() });
    await waitFor(() => expect(view.result.current.sourceSessionId).toBe("shared-chat"));
    expect(view.result.current.workspace).toBeUndefined();
    expect(view.result.current.error).toBeNull();
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  },
);

it("guards the outgoing workspace even when the next chat uses legacy resources", async () => {
  let accept!: () => void;
  const guard = vi.fn((_target, apply) => {
    accept = apply;
  });
  const view = renderHook(({ session }) => useWorkbenchSelection(session, true, guard), {
    wrapper: wrapper(),
    initialProps: { session: "chat-a" },
  });
  await waitFor(() => expect(view.result.current.workspace?.id).toBe("first"));
  vi.mocked(authenticatedFetch).mockResolvedValueOnce(new Response("{}", { status: 403 }));
  view.rerender({ session: "shared-chat" });
  await waitFor(() => expect(guard).toHaveBeenCalled());
  expect(view.result.current.workspace?.id).toBe("first");
  act(() => accept());
  expect(view.result.current.workspace).toBeUndefined();
  expect(view.result.current.sourceSessionId).toBe("shared-chat");
  expect(view.result.current.error).toBeNull();
});
