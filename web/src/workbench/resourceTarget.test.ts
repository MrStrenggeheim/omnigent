import { expect, it } from "vitest";
import { focusedResourceTarget } from "./resourceTarget";
import { panelFolderKey, readPanelFolder, setPanelFolder } from "@/lib/panelFolder";

it("uses a legacy resource's captured session and per-view folder", () => {
  const view = {
    id: "explorer-a",
    kind: "files",
    title: "Files",
    resource: { conversationId: "legacy-a", legacySessionResource: true },
  };
  const target = focusedResourceTarget(view);
  setPanelFolder(panelFolderKey("legacy-a", view.id)!, "src");
  setPanelFolder(panelFolderKey("other-chat", view.id)!, "wrong");
  expect(target).toEqual({
    workspace: undefined,
    conversationId: "legacy-a",
    folderOwner: "legacy-a",
  });
  expect(readPanelFolder(panelFolderKey(target.folderOwner, view.id))).toBe("src");
});
it("does not fabricate an annotation or Activity owner for an independent resource", () => {
  const workspace = { id: "w", root: "/a", host_id: "h", target_kind: "host", capabilities: [] };
  expect(
    focusedResourceTarget({
      id: "global-files",
      title: "Files",
      kind: "files",
      resource: { workspace },
    }),
  ).toEqual({ workspace, conversationId: undefined, folderOwner: "w" });
  expect(focusedResourceTarget(undefined).conversationId).toBeUndefined();
});
