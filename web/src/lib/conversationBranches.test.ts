import { expect, it } from "vitest";
import {
  branchRoots,
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
