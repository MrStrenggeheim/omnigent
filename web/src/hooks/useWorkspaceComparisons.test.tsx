import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { authenticatedFetch } from "@/lib/identity";
import { DEFAULT_WORKSPACE_COMPARISON, setWorkspaceComparison } from "@/lib/workspaceComparison";
import { useWorkspaceComparisonChanges } from "./useWorkspaceComparisons";

vi.mock("@/lib/identity", () => ({ authenticatedFetch: vi.fn() }));
vi.mock("./useWorkspaceChangedFiles", () => ({
  useWorkspaceEnvironment: () => ({ data: { available: true } }),
  useWorkspaceServeable: () => true,
  useSessionActive: () => false,
  useTrailingInvalidate: () => {},
}));
const fetchMock = vi.mocked(authenticatedFetch);
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(cleanup);

describe("workspace comparison lists", () => {
  it("shares explicit commit baseline and scope between consumers", async () => {
    const session = "scope-comparison-hooks";
    setWorkspaceComparison(session, { source: "since", base: "feature~2", target: "WORKTREE" });
    fetchMock.mockResolvedValue(
      response({
        data: [{ path: "repo/a", status: "modified" }],
        repositories: ["/work/repo"],
        root_is_repository: true,
      }),
    );
    const { result } = renderHook(
      () =>
        useWorkspaceComparisonChanges(session, { path: "repo", directories: ["repo/src", "repo"] }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://local");
    expect(url.pathname).toMatch(/\/git$/);
    expect(url.searchParams.get("base")).toBe("feature~2");
    expect(url.searchParams.get("target")).toBe("WORKTREE");
    expect(url.searchParams.get("path")).toBe("repo");
    expect(JSON.parse(url.searchParams.get("directories")!)).toEqual(["repo", "repo/src"]);
    expect(result.current.data?.root_is_repository).toBe(true);
  });

  it("does not retain another comparison's rows when the source changes", async () => {
    const session = "source-comparison-hooks";
    setWorkspaceComparison(session, DEFAULT_WORKSPACE_COMPARISON);
    fetchMock.mockResolvedValueOnce(
      response({ data: [{ path: "git.txt" }], root_is_repository: false }),
    );
    let release!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useWorkspaceComparisonChanges(session), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() =>
      setWorkspaceComparison(session, {
        ...DEFAULT_WORKSPACE_COMPARISON,
        source: "last-turn",
        turnId: "turn-two",
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    const url = new URL(fetchMock.mock.calls[1][0] as string, "http://local");
    expect(url.pathname).toMatch(/\/changes$/);
    expect(url.searchParams.get("turn_id")).toBe("turn-two");
    expect(url.searchParams.get("baseline")).toBe("last_turn");
    await act(async () =>
      release(
        response({
          source: "agent",
          data: [{ path: "agent.txt" }],
          turns: [{ id: "turn-two", label: "Turn 2", finished: true }],
          warning: "Observed file tools only",
        }),
      ),
    );
    await waitFor(() => expect(result.current.data?.data[0].path).toBe("agent.txt"));
    expect(result.current.data?.warning).toBe("Observed file tools only");
  });

  it("keeps server errors and unavailable source distinct from clean folders", async () => {
    fetchMock.mockResolvedValue(
      response({ error: { code: "invalid_revision", message: "Choose a valid commit" } }, 400),
    );
    const { result } = renderHook(() => useWorkspaceComparisonChanges("failed-comparison"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: "Choose a valid commit", status: 400 });
    expect(result.current.data).toBeUndefined();
  });

  it("does not run the query when disabled or missing a real session", () => {
    renderHook(() => useWorkspaceComparisonChanges(undefined), { wrapper: wrapper() });
    renderHook(() => useWorkspaceComparisonChanges("disabled", { enabled: false }), {
      wrapper: wrapper(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
