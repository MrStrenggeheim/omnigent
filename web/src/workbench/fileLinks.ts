import { authenticatedFetch } from "@/lib/identity";
import { ApiError, apiErrorFromResponse } from "@/lib/sessionsApi";
import { resolveChatWorkspace } from "@/hooks/useWorkbenchSelection";
import { citedFilePosition } from "@/shell/filePositionState";
import type { OpenWorkbenchView } from "./WorkbenchContext";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";

export function parseWorkbenchFileLink(
  conversationId: string | undefined,
  search: string,
): OpenWorkbenchView | null {
  const params = new URLSearchParams(search);
  const path = params.get("file");
  const workspaceId = params.get("workspace") || undefined;
  if ((!conversationId && !workspaceId) || !path) return null;
  const position = citedFilePosition({
    line: Number(params.get("line")),
    column: Number(params.get("column")),
    endLine: Number(params.get("endLine")),
  });
  return {
    kind: "preview",
    conversationId,
    path,
    workspaceId,
    fileOptions: { ...position, ...(workspaceId ? { workspaceId } : {}) },
    ...(conversationId && params.get("comment") ? { commentId: params.get("comment")! } : {}),
    ...(params.has("diff") ? { initialDiff: params.get("diff") === "1" } : {}),
  };
}

/** An explicit workspace link is never resolved through whichever chat is now focused. */
export async function resolveWorkbenchFileLink(
  request: OpenWorkbenchView,
): Promise<OpenWorkbenchView> {
  if (request.workspaceId) {
    const response = await authenticatedFetch(
      `/v1/workbench-workspaces/${encodeURIComponent(request.workspaceId)}`,
    );
    if (!response.ok) throw await apiErrorFromResponse(response);
    const workspace = (await response.json()) as WorkbenchWorkspace;
    if (workspace.id !== request.workspaceId || typeof workspace.root !== "string")
      throw new Error("The linked workspace identity is unavailable.");
    return { ...request, workspace };
  }
  if (!request.conversationId) throw new Error("A linked file requires its owning conversation.");
  try {
    return { ...request, workspace: await resolveChatWorkspace(request.conversationId) };
  } catch (error) {
    if (error instanceof ApiError && [403, 404, 405, 501].includes(error.status))
      return { ...request, legacySessionResource: true };
    throw error;
  }
}
