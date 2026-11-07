import type * as TerminalsModule from "@/hooks/useTerminals";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useWorkspaceEnvironment,
  useWorkspaceChangedFiles,
  useWorkspaceGitChanges,
} from "@/hooks/useWorkspaceChangedFiles";
import { useTerminals } from "@/hooks/useTerminals";
import { useWorkspaceResources } from "./useWorkspaceResources";
import { setExplorerGitScope } from "@/lib/explorerGitScope";
import { writeFilesPanelPreferences } from "@/lib/filesPanelPreferences";

vi.mock("@/hooks/useWorkspaceChangedFiles", () => ({
  useWorkspaceEnvironment: vi.fn(() => ({ data: { available: true, root: "/workspace" } })),
  useWorkspaceChangedFiles: vi.fn(() => ({ data: { data: [{ path: "notes.md" }] } })),
  useWorkspaceGitChanges: vi.fn(() => ({ data: { data: [{ path: "notes.md" }] } })),
}));
vi.mock("@/hooks/useTerminals", async (importOriginal) => ({
  ...(await importOriginal<typeof TerminalsModule>()),
  useTerminals: vi.fn(() => ({ terminals: [{ id: "terminal_tui_main" }, { id: "shell" }] })),
}));
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(useWorkspaceGitChanges).mockReturnValue({
    data: { data: [{ path: "notes.md" }] },
  } as ReturnType<typeof useWorkspaceGitChanges>);
  vi.mocked(useWorkspaceChangedFiles).mockReturnValue({
    data: { data: [{ path: "ghost.md" }] },
  } as ReturnType<typeof useWorkspaceChangedFiles>);
});

it.each([
  { permissionLevel: null, shareWorkspaceFiles: false, browse: true },
  { permissionLevel: 2, shareWorkspaceFiles: false, browse: true },
  { permissionLevel: 1, shareWorkspaceFiles: false, browse: false },
  { permissionLevel: 1, shareWorkspaceFiles: true, browse: true },
])("gates file discovery and separates agent and shell terminals: %o", ({ browse, ...access }) => {
  const { result, rerender } = renderHook(
    ({ sessionId, terminalFirst }) =>
      useWorkspaceResources({ ...access, sessionId, terminalFirst, terminalPending: true }),
    { initialProps: { sessionId: "first", terminalFirst: false } },
  );
  expect(useWorkspaceEnvironment).toHaveBeenLastCalledWith("first", { enabled: browse });
  expect(useWorkspaceGitChanges).toHaveBeenLastCalledWith("first", {
    path: "",
    directories: [],
    enabled: browse,
  });
  expect(useWorkspaceChangedFiles).toHaveBeenLastCalledWith("first", {
    source: "agent",
    enabled: false,
  });
  expect(result.current.showFilesPanel).toBe(browse);
  expect(result.current.changedCount).toBe(1);
  expect(result.current.isChangedPath("notes.md")).toBe(true);
  expect(result.current.isChangedPath("unknown.md")).toBe(false);
  expect(result.current.isChangedPath("ghost.md")).toBe(false);
  expect(result.current.openTerminals).toEqual(["terminal:terminal_tui_main", "terminal:shell"]);
  rerender({ sessionId: "second", terminalFirst: true });
  expect(useTerminals).toHaveBeenLastCalledWith("second", { reconcileWhilePending: true });
  expect(result.current.agentTerminal?.id).toBe("terminal_tui_main");
  expect(result.current.openTerminals).toEqual(["terminal:shell"]);
});

it("uses the published nested Git scope for both the counter and file links", () => {
  const gitFiles = ["repo/a.ts", "repo/nested/b.ts", "repo/deleted.ts"];
  vi.mocked(useWorkspaceGitChanges).mockImplementation(
    (_sessionId, options) =>
      ({
        data: { data: options?.path === "repo" ? gitFiles.map((path) => ({ path })) : [] },
      }) as ReturnType<typeof useWorkspaceGitChanges>,
  );
  const { result, rerender } = renderHook(
    ({ sessionId }) => useWorkspaceResources({ sessionId, permissionLevel: 2 }),
    { initialProps: { sessionId: "nested-counter" } },
  );
  expect(result.current.changedCount).toBe(0);
  act(() =>
    setExplorerGitScope("nested-counter", {
      path: "repo",
      directories: ["repo/nested", "repo"],
    }),
  );
  expect(useWorkspaceGitChanges).toHaveBeenLastCalledWith("nested-counter", {
    path: "repo",
    directories: ["repo", "repo/nested"],
    enabled: true,
  });
  expect(result.current.changedCount).toBe(3);
  for (const path of gitFiles) expect(result.current.isChangedPath(path)).toBe(true);
  expect(result.current.isChangedPath("ghost.md")).toBe(false);
  rerender({ sessionId: "counter-other-session" });
  expect(useWorkspaceGitChanges).toHaveBeenLastCalledWith("counter-other-session", {
    path: "",
    directories: [],
    enabled: true,
  });
  expect(result.current.changedCount).toBe(0);
});

it("reacts to the shared agent preference and deduplicates Git and agent paths", () => {
  vi.mocked(useWorkspaceGitChanges).mockReturnValue({
    data: {
      data: [
        { path: "same.ts", status: "deleted" },
        { path: "git.ts", status: "modified" },
      ],
    },
  } as ReturnType<typeof useWorkspaceGitChanges>);
  vi.mocked(useWorkspaceChangedFiles).mockReturnValue({
    data: {
      data: [
        { path: "same.ts", status: "created" },
        { path: "agent.ts", status: "created" },
      ],
    },
  } as ReturnType<typeof useWorkspaceChangedFiles>);
  const first = renderHook(() =>
    useWorkspaceResources({ sessionId: "overlay-a", permissionLevel: 2 }),
  );
  const second = renderHook(() =>
    useWorkspaceResources({ sessionId: "overlay-b", permissionLevel: 2 }),
  );
  expect(first.result.current.changedCount).toBe(2);
  expect(first.result.current.isChangedPath("agent.ts")).toBe(false);
  act(() => writeFilesPanelPreferences({ showAgentChanges: true }));
  expect(useWorkspaceChangedFiles).toHaveBeenLastCalledWith("overlay-b", {
    source: "agent",
    enabled: true,
  });
  for (const result of [first.result, second.result]) {
    expect(result.current.changedCount).toBe(3);
    expect(result.current.isChangedPath("same.ts")).toBe(true);
    expect(result.current.isChangedPath("agent.ts")).toBe(true);
  }
  act(() => writeFilesPanelPreferences({ showAgentChanges: false }));
  expect(first.result.current.changedCount).toBe(2);
  expect(second.result.current.isChangedPath("agent.ts")).toBe(false);
});

it("keeps legacy discovery disabled without file access even when the overlay is enabled", () => {
  writeFilesPanelPreferences({ showAgentChanges: true });
  renderHook(() => useWorkspaceResources({ sessionId: "read-only-counter", permissionLevel: 1 }));
  expect(useWorkspaceChangedFiles).toHaveBeenLastCalledWith("read-only-counter", {
    source: "agent",
    enabled: false,
  });
  expect(useWorkspaceGitChanges).toHaveBeenLastCalledWith("read-only-counter", {
    path: "",
    directories: [],
    enabled: false,
  });
});
