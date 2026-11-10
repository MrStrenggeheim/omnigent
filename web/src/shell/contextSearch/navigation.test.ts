import { describe, expect, it, vi } from "vitest";
import type { FileNavigationGuard } from "../FileViewerContext";
import { consumeSearchNavigationApproval, guardSearchNavigation } from "./navigation";

describe("search navigation through editor guards", () => {
  it("leaves route, source file and draft intact on cancel; approval commits once with the real workspace identity", () => {
    let approve: (() => void) | undefined;
    const draft = "unsent draft";
    let route = "source-chat";
    let file = "/source/notes.md";
    const guard = vi.fn<FileNavigationGuard>((_path, _options, apply) => {
      approve = apply;
    });
    const navigate = vi.fn(() => {
      route = "destination-chat";
      file = "/destination/notes.md";
    });
    guardSearchNavigation([guard], "actual-destination-workspace", navigate);
    expect(guard).toHaveBeenCalledWith(
      "",
      { workspaceId: "actual-destination-workspace" },
      expect.any(Function),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect([route, file, draft]).toEqual(["source-chat", "/source/notes.md", "unsent draft"]);
    approve?.();
    expect(navigate).toHaveBeenCalledTimes(1);
    const approval = { sessionId: "destination-chat", workspaceId: "actual-destination-workspace" };
    const workspaceGuard = vi.fn();
    if (
      !consumeSearchNavigationApproval(approval, "destination-chat", "actual-destination-workspace")
    )
      workspaceGuard();
    expect(workspaceGuard).not.toHaveBeenCalled();
    expect(
      consumeSearchNavigationApproval(approval, "other-chat", "actual-destination-workspace"),
    ).toBe(false);
    expect(consumeSearchNavigationApproval(approval, "destination-chat", "changed-workspace")).toBe(
      false,
    );
  });
});
