import { describe, expect, it } from "vitest";
import { addDockView, createDockLayout } from "./dockLayout";
import { conversationPlacement } from "./viewPlacement";

describe("conversation navigation placement", () => {
  const chat = { id: "chat", kind: "conversation", title: "A", resource: { conversationId: "a" } };
  const explorer = {
    id: "files",
    kind: "files",
    title: "Explorer",
    resource: { workspaceId: "w" },
  };
  it("does not replace a focused tool pane when opening another conversation", () => {
    const layout = addDockView(createDockLayout([chat]), explorer, { edge: "right" });
    expect(conversationPlacement(layout, ["files"], "a")).toEqual({ paneId: "main" });
  });
  it("allocates space instead of adding a chat to a globally pinned tool", () => {
    expect(conversationPlacement(createDockLayout([explorer]), ["files"])).toEqual({
      paneId: "main",
      edge: "left",
    });
  });
});
