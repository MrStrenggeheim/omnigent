import { expect, it } from "vitest";
import {
  branchRoots,
  branchDescendantCounts,
  branchSource,
  visibleBranchRows,
  type BranchConversation,
} from "./conversationBranches";
import { conversation } from "@/test/sidebarMockHelpers";

function branch(id: string, parent?: string): BranchConversation {
  return {
    ...conversation(id),
    branch: parent
      ? { source_conversation_id: parent, reference_only: true, recovery: "replay" }
      : null,
  };
}
it("walks four levels in visible order and retains unreachable ancestors as orphans", () => {
  const rows = [
    branch("root"),
    branch("one", "root"),
    branch("two", "one"),
    branch("three", "two"),
    branch("four", "three"),
    branch("orphan", "private"),
  ];
  expect(branchRoots(rows).map((row) => row.id)).toEqual(["root", "orphan"]);
  expect(
    visibleBranchRows(rows, rows, new Set(["root", "one", "two", "three"])).map((row) => row.id),
  ).toEqual(["root", "one", "two", "three", "four", "orphan"]);
  expect(visibleBranchRows(rows, rows, new Set(["root", "three"])).map((row) => row.id)).toEqual([
    "root",
    "one",
    "orphan",
  ]);
});
it("uses explicit branch provenance, never delegation labels or titles, and bounds cycles", () => {
  const row = {
    ...branch("child", "branch-source"),
    parent_session_id: "delegator",
    title: "Side chat",
  };
  expect(branchSource(row)).toBe("branch-source");
  const withoutBranch: BranchConversation = { ...row, branch: null };
  expect(branchSource(withoutBranch)).toBeUndefined();
  const cycle = [branch("a", "b"), branch("b", "a")];
  expect(visibleBranchRows(cycle, cycle, new Set(["a", "b"])).map((item) => item.id)).toEqual([
    "a",
    "b",
  ]);
});

it("counts all unique descendants, including collapsed grandchildren, and excludes each parent", () => {
  const rows = [
    branch("root"),
    branch("a", "root"),
    branch("b", "root"),
    branch("c", "a"),
    branch("d", "a"),
    branch("e", "b"),
    branch("e", "b"),
  ];
  expect(Object.fromEntries(branchDescendantCounts(rows))).toEqual({
    root: 5,
    a: 2,
    b: 1,
    c: 0,
    d: 0,
    e: 0,
  });
  // Filtering removes edges as well as rows; inaccessible ancestors are never reconstructed.
  expect(Object.fromEntries(branchDescendantCounts(rows.filter((row) => row.id !== "a")))).toEqual({
    root: 2,
    b: 1,
    c: 0,
    d: 0,
    e: 0,
  });
});

it("bounds cycles, self-links and duplicates without dropping attached descendant trees", () => {
  const rows = [
    branch("a", "b"),
    branch("b", "a"),
    branch("c", "a"),
    branch("d", "c"),
    branch("self", "self"),
    branch("a", "b"),
  ];
  expect(Object.fromEntries(branchDescendantCounts(rows))).toEqual({
    a: 3,
    b: 3,
    c: 1,
    d: 0,
    self: 0,
  });
});

it("counts deep graphs without recursive stack limits", () => {
  const rows = Array.from({ length: 10000 }, (_, index) =>
    branch(String(index), index ? String(index - 1) : undefined),
  );
  const counts = branchDescendantCounts(rows);
  expect(counts.get("0")).toBe(9999);
  expect(counts.get("9999")).toBe(0);
});
