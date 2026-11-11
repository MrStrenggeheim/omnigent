import { describe, expect, it } from "vitest";
import { legacyWorkspaceViews } from "./legacyLayout";
import { createDockLayout, parseDockLayout } from "./dockLayout";

describe("legacy workspace migration", () => {
  it("preserves captured resource identities and never creates pending children", () => {
    const workspace = {
      id: "workspace-a",
      root: "/project",
      host_id: "host-a",
      target_kind: "host" as const,
      capabilities: [],
    };
    const views = legacyWorkspaceViews(
      "chat-a",
      {
        openFiles: ["notes.md"],
        openTerminals: ["terminal:shell-a"],
        openSideChats: ["pending:1", "child-a"],
        openPanels: ["files"],
      },
      workspace,
    );
    expect(views.map((view) => view.kind)).toEqual([
      "conversation",
      "files",
      "preview",
      "terminal",
    ]);
    expect(views.at(-1)?.resource).toMatchObject({
      conversationId: "chat-a",
      terminalId: "shell-a",
      terminalOwner: "conversation",
    });
    expect(parseDockLayout(createDockLayout(views))).toBeDefined();
  });
  it("keeps session-owned resources on the session API and honors a closed rail", () => {
    expect(legacyWorkspaceViews("a", { open: false, openFiles: ["notes.md"] })).toEqual([]);
    expect(legacyWorkspaceViews("a", { openFiles: ["notes.md"] })[0].resource).toEqual({
      conversationId: "a",
      legacySessionResource: true,
      path: "notes.md",
    });
  });
  it("keeps equal shell IDs in separate recorded namespaces", () => {
    const workspace = {
      id: "w",
      root: "/project",
      host_id: "h",
      target_kind: "host" as const,
      capabilities: [],
    };
    const state = { openTerminals: ["terminal:same"], openFiles: ["same.txt"] };
    const views = legacyWorkspaceViews("chat", state, workspace, state);
    const terminals = views.filter((view) => view.kind === "terminal");
    expect(terminals).toHaveLength(2);
    expect(terminals[0].resource).toMatchObject({
      terminalOwner: "conversation",
      conversationId: "chat",
    });
    expect(terminals[0].resource).not.toHaveProperty("workspace");
    expect(terminals[1].resource).toMatchObject({ terminalOwner: "workspace", workspace });
    expect(new Set(views.map((view) => view.id)).size).toBe(4);
    expect(parseDockLayout(createDockLayout(views))).toBeDefined();
  });
});
