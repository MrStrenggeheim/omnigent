import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_COMPARISON,
  getWorkspaceComparison,
  workspaceComparisonKey,
  getFileComparisonScope,
  setFileComparisonScope,
  setWorkspaceComparison,
  subscribeWorkspaceComparisons,
} from "./workspaceComparison";

describe("workspace comparisons", () => {
  it("keeps file and list consumers on one immutable per-session selection", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceComparisons(listener);
    expect(getWorkspaceComparison("new-session")).toBe(DEFAULT_WORKSPACE_COMPARISON);
    const selected = { source: "range" as const, base: "v1", target: "v2" };
    setWorkspaceComparison("comparison-session", selected);
    const snapshot = getWorkspaceComparison("comparison-session");
    selected.target = "external";
    expect(snapshot.target).toBe("v2");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(getWorkspaceComparison("other-session")).toBe(DEFAULT_WORKSPACE_COMPARISON);
    setWorkspaceComparison("comparison-session", { source: "range", base: "v1", target: "v2" });
    expect(getWorkspaceComparison("comparison-session")).toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("keeps selected captured turns distinct and retires old session selections", () => {
    setWorkspaceComparison("turn-session", {
      ...DEFAULT_WORKSPACE_COMPARISON,
      source: "last-turn",
      turnId: "turn-a",
    });
    const previous = getWorkspaceComparison("turn-session");
    setWorkspaceComparison("turn-session", { ...previous, turnId: "turn-b" });
    expect(getWorkspaceComparison("turn-session").turnId).toBe("turn-b");
    for (let index = 0; index < 100; index++)
      setWorkspaceComparison(`bounded-comparison-${index}`, {
        ...DEFAULT_WORKSPACE_COMPARISON,
        source: "agent",
      });
    expect(getWorkspaceComparison("turn-session")).toBe(DEFAULT_WORKSPACE_COMPARISON);
  });
});

describe("independent Explorer selections", () => {
  it("separates Files and Changes while retaining workspace selections across chat changes", () => {
    const files = { workspaceId: "independent", conversationId: "chat-a", view: "files" as const };
    const changes = { ...files, view: "changes" as const };
    const revisions = { source: "range" as const, base: "v1", target: "v2" };
    setWorkspaceComparison(files, revisions);
    setWorkspaceComparison(changes, { ...DEFAULT_WORKSPACE_COMPARISON, source: "agent" });
    expect(getWorkspaceComparison(files)).toEqual(revisions);
    expect(getWorkspaceComparison(changes)).toMatchObject({
      source: "agent",
      sourceChatId: "chat-a",
    });
    expect(getWorkspaceComparison({ ...files, conversationId: "chat-b" })).toBe(
      getWorkspaceComparison(files),
    );
    expect(getWorkspaceComparison({ ...changes, conversationId: "chat-b" }).sourceChatId).toBe(
      "chat-a",
    );
    expect(getWorkspaceComparison({ ...files, workspaceId: "another" })).toBe(
      DEFAULT_WORKSPACE_COMPARISON,
    );
    expect(getWorkspaceComparison("independent")).toBe(DEFAULT_WORKSPACE_COMPARISON);
  });

  it("requires chat provenance for captures in a workspace without Chat Activity", () => {
    const scope = { workspaceId: "no-chat", view: "changes" as const };
    setWorkspaceComparison(scope, { ...DEFAULT_WORKSPACE_COMPARISON, source: "agent" });
    expect(getWorkspaceComparison(scope)).toBe(DEFAULT_WORKSPACE_COMPARISON);
    setWorkspaceComparison(scope, {
      ...DEFAULT_WORKSPACE_COMPARISON,
      source: "agent",
      sourceChatId: "explicit-chat",
    });
    expect(getWorkspaceComparison(scope).sourceChatId).toBe("explicit-chat");
  });

  it("remembers file-tab origins independently of the current view and workspace", () => {
    const scope = { workspaceId: "origin-workspace", conversationId: "chat-a" };
    expect(getFileComparisonScope(scope, "file.ts")).toBeUndefined();
    setFileComparisonScope(scope, "file.ts", "files");
    setFileComparisonScope(scope, "another.ts", "changes");
    expect(
      getFileComparisonScope({ ...scope, conversationId: "chat-b", view: "changes" }, "file.ts"),
    ).toBe("files");
    expect(getFileComparisonScope(scope, "another.ts")).toBe("changes");
    expect(getFileComparisonScope({ workspaceId: "other-workspace" }, "file.ts")).toBeUndefined();
  });

  it("restores both selections and their captured source chat after a module reload", async () => {
    const files = { workspaceId: "reload", view: "files" as const };
    const changes = { ...files, view: "changes" as const, conversationId: "source-chat" };
    setWorkspaceComparison(files, { source: "since", base: "stable", target: "WORKTREE" });
    setWorkspaceComparison(changes, {
      ...DEFAULT_WORKSPACE_COMPARISON,
      source: "last-turn",
      turnId: "captured-turn",
    });
    setFileComparisonScope(files, "file.ts", "changes");
    vi.resetModules();
    const restored = await import("./workspaceComparison");
    expect(restored.getFileComparisonScope(files, "file.ts")).toBe("changes");
    expect(restored.getWorkspaceComparison(files)).toEqual(getWorkspaceComparison(files));
    expect(restored.getWorkspaceComparison(changes)).toEqual(getWorkspaceComparison(changes));
    expect(Object.isFrozen(restored.getWorkspaceComparison(files))).toBe(true);
  });

  it("ignores malformed persisted entries and captures without provenance", async () => {
    localStorage.setItem(
      "omnigent:workspace-comparisons:v1",
      JSON.stringify([
        [workspaceComparisonKey("bad"), { source: "invented", base: "HEAD", target: "WORKTREE" }],
        [
          workspaceComparisonKey("missing-chat"),
          { source: "agent", base: "HEAD", target: "WORKTREE" },
        ],
        null,
      ]),
    );
    vi.resetModules();
    const restored = await import("./workspaceComparison");
    expect(restored.getWorkspaceComparison("bad")).toBe(restored.DEFAULT_WORKSPACE_COMPARISON);
    expect(restored.getWorkspaceComparison("missing-chat")).toBe(
      restored.DEFAULT_WORKSPACE_COMPARISON,
    );
  });
});
