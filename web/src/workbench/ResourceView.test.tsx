import { useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ResourceView, inheritResourceViewState } from "./ResourceView";
import { getWorkspaceComparison, setWorkspaceComparison } from "@/lib/workspaceComparison";
import { getExplorerGitScope, setExplorerGitScope } from "@/lib/explorerGitScope";
import { FileViewerContext, type FileNavigationGuard } from "@/shell/FileViewerContext";
import { useWorkbenchWorkspace, type WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import { useWriteFileContent } from "@/hooks/useWriteFileContent";
import { authenticatedFetch } from "@/lib/identity";

const state = vi.hoisted(() => ({
  openContentSearch: undefined as ((path: string, replace?: boolean) => void) | undefined,
  prompts: 0,
  accept: undefined as (() => void) | undefined,
  guard: undefined as FileNavigationGuard | undefined,
}));
vi.mock("@/hooks/useHosts", () => ({
  useHosts: () => ({ data: [{ host_id: "host-a", name: "Machine A", status: "online" }] }),
}));
vi.mock("@/hooks/useSession", () => ({ useSession: () => ({ session: null }) }));
vi.mock("@/lib/identity", () => ({
  authenticatedFetch: vi.fn(),
  getCurrentUserId: () => "resource-test",
}));
vi.mock("@/shell/WorkspacePickerDialog", () => ({
  WorkspacePickerDialog: ({ onConfirm }: { onConfirm: (path: string) => void }) => (
    <button type="button" onClick={() => onConfirm("/new")}>
      Choose new folder
    </button>
  ),
}));
vi.mock("@/shell/FilesPanel", () => ({
  FilesPanel: ({
    onFileSelect,
    sort,
    locationControls,
  }: {
    onFileSelect: (path: string) => void;
    sort: string;
    locationControls?: ReactNode;
  }) => (
    <>
      <div data-testid="files-toolbar">{locationControls}</div>
      <button type="button" onClick={() => onFileSelect("file.txt")}>
        Open {sort}
      </button>
    </>
  ),
}));
vi.mock("@/shell/ContentSearchPanel", () => ({ ContentSearchPanel: () => null }));
vi.mock("@/shell/PullRequestPanel", () => ({ PullRequestPanel: () => null }));
vi.mock("@/shell/FileViewer", () => ({
  FileViewer: ({
    conversationId,
    path,
    recipientValid,
    locationControls,
  }: {
    conversationId: string;
    path: string;
    recipientValid: boolean;
    locationControls?: ReactNode;
  }) => {
    const context = useContext(FileViewerContext)!;
    state.openContentSearch = context.openContentSearch;
    const workspace = useWorkbenchWorkspace();
    const save = useWriteFileContent(conversationId);
    useLayoutEffect(
      () =>
        context.registerNavigationGuard?.((_path, _options, apply) => {
          state.prompts += 1;
          state.accept = apply;
        }),
      [context],
    );
    return (
      <>
        {locationControls}
        <button type="button" onClick={() => save.mutate({ path, content: "captured", workspace })}>
          Save {workspace?.id ?? "legacy"} {recipientValid ? conversationId : "no recipient"}
        </button>
      </>
    );
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.prompts = 0;
  state.accept = undefined;
  state.guard = undefined;
});
const original: WorkbenchWorkspace = {
  id: "original",
  root: "/old",
  host_id: "host-a",
  target_kind: "host",
  capabilities: ["files"],
  permission_level: 4,
};
const next: WorkbenchWorkspace = { ...original, id: "next", root: "/new" };
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}
it("opens files with the captured workspace and defaults to filename order", () => {
  const open = vi.fn();
  render(<ResourceView viewId="explorer" kind="files" workspace={original} onOpenFile={open} />, {
    wrapper,
  });
  fireEvent.click(screen.getByText("Open alpha"));
  expect(open).toHaveBeenCalledWith(
    "file.txt",
    expect.objectContaining({
      workspace: original,
      workspaceId: "original",
      sourceViewId: "explorer",
    }),
  );
});
it("guards a location switch and close while a started save retains its captured target", async () => {
  let finishSave!: (response: Response) => void;
  vi.mocked(authenticatedFetch).mockImplementation((url, options) => {
    if (options?.method === "PUT")
      return new Promise((resolve) => {
        finishSave = resolve;
      });
    expect(url).toBe("/v1/workbench-workspaces");
    expect(JSON.parse(String(options?.body))).toEqual({ host_id: "host-a", root: "/new" });
    return Promise.resolve(new Response(JSON.stringify(next)));
  });
  const changed = vi.fn();
  function Harness() {
    const [workspace, setWorkspace] = useState(original);
    return (
      <ResourceView
        viewId="editor"
        kind="preview"
        workspace={workspace}
        path="file.txt"
        onOpenFile={vi.fn()}
        onWorkspaceChange={(value) => {
          state.guard!("", { workspaceId: value.id }, () => {
            changed(value);
            setWorkspace(value);
          });
        }}
        registerNavigationGuard={(guard) => {
          state.guard = guard;
          return () => {
            state.guard = undefined;
          };
        }}
      />
    );
  }
  render(<Harness />, { wrapper });
  fireEvent.click(screen.getByText("Save original no recipient"));
  await waitFor(() => expect(finishSave).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Location" }));
  fireEvent.click(screen.getByRole("button", { name: "Select folder" }));
  fireEvent.click(screen.getByText("Choose new folder"));
  await waitFor(() => expect(state.accept).toBeDefined());
  expect(changed).not.toHaveBeenCalled();
  expect(state.prompts).toBe(1);
  expect(screen.getByText("Save original no recipient")).toBeInTheDocument();
  act(() => state.accept!());
  expect(screen.getByText("Save next no recipient")).toBeInTheDocument();
  expect(state.prompts).toBe(1);
  await act(async () => finishSave(new Response("{}")));
  const writes = vi
    .mocked(authenticatedFetch)
    .mock.calls.filter(([, options]) => options?.method === "PUT");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe(
    "/v1/workbench-workspaces/original/resources/environments/default/filesystem/file.txt",
  );
  const close = vi.fn();
  act(() => state.guard!("", undefined, close));
  expect(close).not.toHaveBeenCalled();
  act(() => state.accept!());
  expect(close).toHaveBeenCalledOnce();
});
it("retains an unavailable target instead of selecting an online machine", () => {
  const open = vi.fn();
  render(
    <ResourceView
      viewId="offline"
      kind="files"
      workspace={{ ...original, host_id: "missing", available: false }}
      onOpenFile={open}
    />,
    { wrapper },
  );
  expect(screen.getByRole("status")).toHaveTextContent("Location unavailable: missing · /old");
  fireEvent.click(screen.getByText("Open alpha"));
  expect(open.mock.calls[0][1].workspace.host_id).toBe("missing");
});

it("copies preview comparison and repository scope once without following the explorer", () => {
  const source = { workspaceId: "inherit", viewId: "explorer", view: "files" as const };
  const preview = { ...source, viewId: "preview" };
  setWorkspaceComparison(source, { source: "range", base: "v1", target: "v2" });
  setExplorerGitScope(source, { path: "repo", directories: ["repo/src"] });
  inheritResourceViewState("explorer", "preview", "inherit", "files");
  setWorkspaceComparison(source, { source: "range", base: "v2", target: "v3" });
  setExplorerGitScope(source, { path: "other", directories: ["other"] });
  expect(getWorkspaceComparison(preview)).toEqual({ source: "range", base: "v1", target: "v2" });
  expect(getExplorerGitScope(preview)).toEqual({ path: "repo", directories: ["repo/src"] });
});

it("uses only the captured shared session when no independent workspace was authorized", async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response("{}"));
  const open = vi.fn();
  const mounted = render(
    <ResourceView
      viewId="shared"
      kind="preview"
      conversationId="shared-owner"
      path="file.txt"
      onOpenFile={open}
    />,
    { wrapper },
  );
  expect(screen.queryByRole("combobox", { name: "Machine" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Save legacy shared-owner"));
  await waitFor(() =>
    expect(authenticatedFetch).toHaveBeenCalledWith(
      "/v1/sessions/shared-owner/resources/environments/default/filesystem/file.txt",
      expect.objectContaining({ method: "PUT" }),
    ),
  );
  mounted.unmount();
  render(<ResourceView viewId="no-target" kind="files" onOpenFile={open} />, { wrapper });
  expect(screen.getByRole("status")).toHaveTextContent("No resource target selected");
});

const capturedSearchContext = {
  openFile: vi.fn(),
  openContentSearch: vi.fn(),
  openGithubTab: vi.fn(),
  isChangedPath: () => false,
  conversationId: "captured-owner",
  workspaceRoot: "/old",
  workspaceHome: null,
};

it("forwards the enclosing view's captured content-search action", () => {
  const openContentSearch = capturedSearchContext.openContentSearch;

  render(
    <FileViewerContext.Provider value={capturedSearchContext}>
      <ResourceView
        viewId="search-source"
        kind="preview"
        workspace={original}
        path="file.txt"
        onOpenFile={vi.fn()}
      />
    </FileViewerContext.Provider>,
    { wrapper },
  );
  expect(state.openContentSearch).toBe(openContentSearch);
  act(() => state.openContentSearch!("src", true));
  expect(openContentSearch).toHaveBeenCalledWith("src", true);
});
