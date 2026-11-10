import { apiErrorFromResponse } from "@/lib/sessionsApi";
import { useContext, useRef } from "react";
import { FileViewerContext } from "@/shell/FileViewerContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useWorkbenchWorkspace,
  resourceBase,
  queryIdentity,
  type WorkbenchWorkspace,
  type WorkspaceResourceTarget,
} from "@/lib/workbenchWorkspace";
import { authenticatedFetch } from "@/lib/identity";
import { browseLocationBase, browseLocationSegment } from "@/hooks/useWorkspaceChangedFiles";
import type { FileContentResponse } from "./useFileContent";

const DEFAULT_ENVIRONMENT_ID = "default";

async function writeFileContent(
  conversationId: string,
  path: string,
  content: string,
  workspace?: WorkspaceResourceTarget,
  workspaceRoot?: string | null,
): Promise<void> {
  // Same slash-merge-safe wire form as the read path, via the shared helpers:
  // a bare per-segment-encoded path, and `?base=host` for an absolute location
  // (saving a file edited outside the workspace). See `browseLocationSegment`.
  const encodedPath = browseLocationSegment(path);
  const base = browseLocationBase(path);
  const url =
    resourceBase(workspace, conversationId) +
    `/environments/${DEFAULT_ENVIRONMENT_ID}/filesystem/${encodedPath}` +
    (base ? `?base=${base}` : "");
  const res = await authenticatedFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      encoding: "utf-8",
      ...(!workspace && workspaceRoot ? { workspace_root: workspaceRoot } : {}),
    }),
  });
  if (!res.ok) throw await apiErrorFromResponse(res);
}

/**
 * Write the content of a workspace file for the given conversation.
 * Invalidates the file-content query on success so the viewer refreshes.
 */
export function useWriteFileContent(
  conversationId: string,
  explicitWorkspace?: WorkbenchWorkspace | null,
) {
  const workspace = useWorkbenchWorkspace(explicitWorkspace);
  const root = useRef(useContext(FileViewerContext)?.workspaceRoot ?? workspace?.root);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      content,
      workspace: capturedWorkspace,
    }: {
      path: string;
      content: string;
      workspace?: WorkspaceResourceTarget;
    }) =>
      writeFileContent(
        conversationId,
        path,
        content,
        capturedWorkspace === undefined ? workspace : capturedWorkspace,
        root.current,
      ),
    onMutate: ({ workspace: capturedWorkspace }) => ({
      identity: queryIdentity(
        capturedWorkspace === undefined ? workspace : capturedWorkspace,
        conversationId,
      ),
    }),
    onSuccess: (_, { path, content }, context) => {
      const identity = context.identity;
      queryClient.setQueryData<FileContentResponse>(["file-content", identity, path], (old) =>
        old ? { ...old, content } : undefined,
      );
      queryClient.invalidateQueries({ queryKey: ["file-content", identity, path] });
      queryClient.invalidateQueries({ queryKey: ["workspace-changed-files", identity] });
    },
  });
}
