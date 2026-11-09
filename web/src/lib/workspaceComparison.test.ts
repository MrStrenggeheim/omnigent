import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_COMPARISON,
  getWorkspaceComparison,
  setWorkspaceComparison,
  subscribeWorkspaceComparisons,
} from "./workspaceComparison";

describe("shared workspace comparisons", () => {
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
