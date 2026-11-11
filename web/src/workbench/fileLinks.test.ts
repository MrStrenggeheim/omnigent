import { beforeEach, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/lib/identity";
import { resolveChatWorkspace } from "@/hooks/useWorkbenchSelection";
import { ApiError } from "@/lib/sessionsApi";
import { parseWorkbenchFileLink, resolveWorkbenchFileLink } from "./fileLinks";

vi.mock("@/lib/identity", () => ({ authenticatedFetch: vi.fn() }));
vi.mock("@/hooks/useWorkbenchSelection", () => ({ resolveChatWorkspace: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("captures an Inbox/file link including its exact workspace, position, comment and diff", async () => {
  const request = parseWorkbenchFileLink(
    "owner-a",
    "?file=src%2Fa.py&workspace=workspace-a&comment=comment-a&diff=1&line=12&column=3&endLine=15",
  )!;
  expect(request).toMatchObject({
    conversationId: "owner-a",
    path: "src/a.py",
    workspaceId: "workspace-a",
    commentId: "comment-a",
    initialDiff: true,
    fileOptions: { workspaceId: "workspace-a", line: 12, column: 3, endLine: 15 },
  });
  const workspace = {
    id: "workspace-a",
    root: "/captured",
    host_id: "host-a",
    target_kind: "host",
    capabilities: [],
  };
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify(workspace)));
  expect(await resolveWorkbenchFileLink(request)).toMatchObject({
    conversationId: "owner-a",
    workspace,
  });
  expect(authenticatedFetch).toHaveBeenCalledWith("/v1/workbench-workspaces/workspace-a");
  expect(resolveChatWorkspace).not.toHaveBeenCalled();
});
it("never substitutes another workspace when the explicit linked identity is denied", async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response("{}", { status: 403 }));
  await expect(
    resolveWorkbenchFileLink(
      parseWorkbenchFileLink("owner-a", "?file=file.txt&workspace=unavailable")!,
    ),
  ).rejects.toBeInstanceOf(ApiError);
  expect(resolveChatWorkspace).not.toHaveBeenCalled();
});
it("retains the captured shared session when independent workspace resolution is owner-only", async () => {
  vi.mocked(resolveChatWorkspace).mockRejectedValue(new ApiError("Owner only", 403, "forbidden"));
  expect(
    await resolveWorkbenchFileLink(
      parseWorkbenchFileLink("shared-a", "?file=notes.md&comment=c1")!,
    ),
  ).toMatchObject({ conversationId: "shared-a", legacySessionResource: true, commentId: "c1" });
  expect(resolveChatWorkspace).toHaveBeenCalledExactlyOnceWith("shared-a");
  expect(authenticatedFetch).not.toHaveBeenCalled();
});
it("requires a captured file and conversation and ignores invalid positions", () => {
  expect(parseWorkbenchFileLink(undefined, "?file=file.txt")).toBeNull();
  expect(parseWorkbenchFileLink("a", "?comment=c")).toBeNull();
  expect(parseWorkbenchFileLink("a", "?file=x&line=-1&column=NaN")?.fileOptions).toEqual({});
});

it("keeps workspace-only links unowned instead of borrowing the current chat", () => {
  const request = parseWorkbenchFileLink(
    undefined,
    "?view=workbench&file=file.txt&workspace=exact&comment=unowned",
  );
  expect(request).toMatchObject({ kind: "preview", workspaceId: "exact", path: "file.txt" });
  expect(request?.conversationId).toBeUndefined();
  expect(request?.commentId).toBeUndefined();
});
