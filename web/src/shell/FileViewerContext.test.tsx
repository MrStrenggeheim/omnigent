import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { WorkbenchWorkspaceProvider, type WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import { FileViewerContext, useSessionHostIdentity, useWorkspacePaths } from "./FileViewerContext";

const chat = {
  openFile: () => {},
  openGithubTab: () => {},
  isChangedPath: () => false,
  conversationId: "chat",
  workspaceRoot: "/chat-root",
  workspaceHome: "/chat-home",
  sessionHostId: "chat-host",
};
const selected: WorkbenchWorkspace = {
  id: "selected",
  root: "/selected-root",
  home: "/selected-home",
  host_id: "selected-host",
  target_kind: "host",
  capabilities: ["files"],
};
it("uses selected paths and host inside the workspace while preserving chat citation provenance", () => {
  const view = renderHook(() => [useWorkspacePaths(), useSessionHostIdentity()], {
    wrapper: ({ children }) => (
      <FileViewerContext.Provider value={chat}>
        <WorkbenchWorkspaceProvider value={selected}>{children}</WorkbenchWorkspaceProvider>
      </FileViewerContext.Provider>
    ),
  });
  expect(view.result.current).toEqual([
    { root: "/selected-root", home: "/selected-home" },
    "selected-host",
  ]);
  view.unmount();
  const citation = renderHook(() => [useWorkspacePaths(), useSessionHostIdentity()], {
    wrapper: ({ children }) => (
      <FileViewerContext.Provider value={chat}>{children}</FileViewerContext.Provider>
    ),
  });
  expect(citation.result.current).toEqual([
    { root: "/chat-root", home: "/chat-home" },
    "chat-host",
  ]);
});

it("keeps unknown selected host and home separate from the current chat", () => {
  const { result } = renderHook(() => [useWorkspacePaths(), useSessionHostIdentity()], {
    wrapper: ({ children }) => (
      <WorkbenchWorkspaceProvider
        value={{
          id: "runner",
          root: "/sandbox",
          host_id: null,
          target_kind: "runner",
          capabilities: [],
        }}
      >
        {children}
      </WorkbenchWorkspaceProvider>
    ),
  });
  expect(result.current).toEqual([{ root: "/sandbox", home: null }, null]);
});
