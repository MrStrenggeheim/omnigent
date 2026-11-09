import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  WorkbenchWorkspaceProvider,
  queryIdentity,
  resourceBase,
  useWorkbenchWorkspace,
  workspaceResourceUrl,
  type WorkbenchWorkspace,
} from "./workbenchWorkspace";

const workspace: WorkbenchWorkspace = {
  id: "workspace a/#",
  root: "/project",
  host_id: "host",
  target_kind: "host",
  capabilities: ["files"],
};

describe("workspace resource identity", () => {
  it("encodes the workspace identity and uses it independently of chat", () => {
    expect(resourceBase(workspace, "chat-a")).toBe(
      "/v1/workbench-workspaces/workspace%20a%2F%23/resources",
    );
    expect(resourceBase(workspace.id, "chat-b")).toBe(resourceBase(workspace));
    expect(workspaceResourceUrl(workspace, undefined, "environments/default/git")).toBe(
      `${resourceBase(workspace)}/environments/default/git`,
    );
    expect(queryIdentity(workspace, "chat-a")).toBe(queryIdentity(workspace, "chat-b"));
    expect(queryIdentity({ id: "another" })).not.toBe(queryIdentity(workspace));
    expect(queryIdentity(workspace)).not.toBe(queryIdentity(null, workspace.id));
  });

  it("preserves legacy URLs and cache identities only without a workspace", () => {
    expect(resourceBase(null, "chat a")).toBe("/v1/sessions/chat%20a/resources");
    expect(queryIdentity(undefined, "chat-a")).toBe("chat-a");
    expect(queryIdentity(null, "temp:pending")).toBeUndefined();
    expect(queryIdentity(workspace, "temp:pending")).toBeDefined();
    expect(() => resourceBase(undefined)).toThrow("resource target is required");
    expect(() => resourceBase({ id: "" }, "unrelated-chat")).toThrow("must have an id");
    expect(queryIdentity({ id: "" }, "unrelated-chat")).toBeUndefined();
  });

  it("allows explicit discovery and null chat provenance to override the provider", () => {
    const other = { ...workspace, id: "other" };
    const { result } = renderHook(
      () => [useWorkbenchWorkspace(), useWorkbenchWorkspace(other), useWorkbenchWorkspace(null)],
      {
        wrapper: ({ children }) => (
          <WorkbenchWorkspaceProvider value={workspace}>{children}</WorkbenchWorkspaceProvider>
        ),
      },
    );
    expect(result.current).toEqual([workspace, other, null]);
  });
});
