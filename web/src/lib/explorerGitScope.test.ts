import { describe, expect, it, vi } from "vitest";
import {
  getExplorerGitScope,
  setExplorerGitScope,
  subscribeExplorerGitScopes,
} from "./explorerGitScope";

describe("Explorer Git scopes", () => {
  it("returns one stable root scope before publication and ignores missing sessions", () => {
    const initial = getExplorerGitScope(undefined);
    expect(initial).toEqual({ path: "", directories: [] });
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.directories)).toBe(true);
    expect(getExplorerGitScope("unpublished")).toBe(initial);
    setExplorerGitScope(undefined, { path: "ignored", directories: ["ignored"] });
    expect(getExplorerGitScope(undefined)).toBe(initial);
  });

  it("copies, deduplicates, and sorts directories without changing equivalent snapshots", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeExplorerGitScopes(changed);
    const directories = ["src/z", "src", "src/a", "src"];
    setExplorerGitScope("sorted", { path: "src", directories });
    const snapshot = getExplorerGitScope("sorted");
    expect(snapshot).toEqual({ path: "src", directories: ["src", "src/a", "src/z"] });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.directories)).toBe(true);
    directories.push("src/later");
    expect(snapshot.directories).not.toContain("src/later");
    setExplorerGitScope("sorted", { path: "src", directories: ["src/z", "src/a", "src"] });
    expect(getExplorerGitScope("sorted")).toBe(snapshot);
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("notifies on path or directory changes and unsubscribes cleanly", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeExplorerGitScopes(changed);
    setExplorerGitScope("notify", { path: "repo", directories: ["repo"] });
    const first = getExplorerGitScope("notify");
    setExplorerGitScope("notify", { path: "repo", directories: ["repo", "repo/nested"] });
    expect(getExplorerGitScope("notify")).not.toBe(first);
    setExplorerGitScope("notify", { path: "other", directories: ["repo", "repo/nested"] });
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    setExplorerGitScope("notify", { path: "after", directories: [] });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("keeps each conversation's snapshot independent", () => {
    setExplorerGitScope("scope-a", { path: "/outside", directories: ["/outside"] });
    const first = getExplorerGitScope("scope-a");
    setExplorerGitScope("scope-b", { path: "nested", directories: ["nested"] });
    expect(getExplorerGitScope("scope-a")).toBe(first);
    expect(getExplorerGitScope("scope-b").path).toBe("nested");
  });

  it("retains at most 100 conversations and refreshes recency when a scope changes", () => {
    for (let i = 0; i < 100; i++) {
      setExplorerGitScope(`bounded-${i}`, { path: `repo-${i}`, directories: [] });
    }
    expect(getExplorerGitScope("bounded-0").path).toBe("repo-0");
    setExplorerGitScope("bounded-0", { path: "recent", directories: [] });
    setExplorerGitScope("overflow", { path: "new", directories: [] });
    expect(getExplorerGitScope("bounded-1")).toBe(getExplorerGitScope(undefined));
    expect(getExplorerGitScope("bounded-0").path).toBe("recent");
    expect(getExplorerGitScope("bounded-99").path).toBe("repo-99");
  });
});
