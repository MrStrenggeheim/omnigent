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

it("keeps the selected workspace when chat moves to another host and persists explicit selection", async () => {
  const view = renderHook(({ session }) => useWorkbenchSelection(session), {
    wrapper: wrapper(),
    initialProps: { session: "chat-a" },
  });
  await waitFor(() => expect(view.result.current.workspace?.id).toBe("first"));
  view.rerender({ session: "chat-b" });
  await waitFor(() => expect(view.result.current.chatWorkspace?.id).toBe("second"));
  expect(view.result.current.workspace?.id).toBe("first");
  expect(view.result.current.mismatch).toBe(true);
  act(() => view.result.current.select(second));
  await waitFor(() => expect(view.result.current.mismatch).toBe(false));
  expect(localStorage.getItem("omnigent:workbench-selection:owner")).toBe("second");
  view.unmount();
  const reopened = renderHook(() => useWorkbenchSelection("chat-a"), { wrapper: wrapper() });
  await waitFor(() => expect(reopened.result.current.workspace?.id).toBe("second"));
  expect(reopened.result.current.workspace?.host_id).toBe("host-b");
});

it("keeps a revoked selection unavailable rather than silently switching to the chat filesystem", async () => {
  localStorage.setItem("omnigent:workbench-selection:owner", "revoked");
  const view = renderHook(() => useWorkbenchSelection("chat-a"), { wrapper: wrapper() });
  await waitFor(() => expect(view.result.current.error).toBeTruthy());
  expect(view.result.current.workspace).toBeUndefined();
  expect(view.result.current.selectedId).toBe("revoked");
  expect(localStorage.getItem("omnigent:workbench-selection:owner")).toBe("revoked");
});
