import { createContext, useContext, type ReactNode } from "react";
import type { WorkbenchWorkspace as WorkspaceMetadata } from "./workbenchTypes";
import { isTempConvId } from "./tempConversationId";

/** The selected resource target, independent of the chat currently on screen. */
export interface WorkbenchWorkspace extends WorkspaceMetadata {
  chatSessionId?: string | null;
  home?: string | null;
}

export type WorkspaceResourceTarget = Pick<WorkbenchWorkspace, "id"> | string | null | undefined;

const WorkbenchWorkspaceContext = createContext<WorkbenchWorkspace | null>(null);

export function WorkbenchWorkspaceProvider({
  value,
  children,
}: {
  value: WorkbenchWorkspace | null;
  children?: ReactNode;
}) {
  return (
    <WorkbenchWorkspaceContext.Provider value={value}>
      {children}
    </WorkbenchWorkspaceContext.Provider>
  );
}

/** Pass null explicitly for chat provenance or legacy session resources. */
export function useWorkbenchWorkspace(explicit?: WorkbenchWorkspace | null) {
  const workspace = useContext(WorkbenchWorkspaceContext);
  return explicit === undefined ? workspace : explicit;
}

function workspaceId(workspace: WorkspaceResourceTarget): string | undefined {
  return typeof workspace === "string" ? workspace : workspace?.id;
}

/** Only callers without a workspace target may use the legacy session API. */
export function resourceBase(
  workspace: WorkspaceResourceTarget,
  sessionId?: string | null,
): string {
  const id = workspaceId(workspace);
  if (id) return `/v1/workbench-workspaces/${encodeURIComponent(id)}/resources`;
  if (workspace != null) throw new Error("A workspace resource target must have an id.");
  if (!sessionId) throw new Error("A workspace or session resource target is required.");
  return `/v1/sessions/${encodeURIComponent(sessionId)}/resources`;
}

/** Resource suffixes include environments/default for filesystem, search and Git. */
export function workspaceResourceUrl(
  workspace: WorkspaceResourceTarget,
  sessionId: string | null | undefined,
  path = "",
): string {
  return `${resourceBase(workspace, sessionId)}${path && !path.startsWith("/") ? "/" : ""}${path}`;
}

/** Keep legacy cache keys stable while separating workspace targets from chats. */
export function queryIdentity(
  workspace: WorkspaceResourceTarget,
  sessionId?: string | null,
): string | undefined {
  const id = workspaceId(workspace);
  if (workspace != null && !id) return undefined;
  return id
    ? `workbench-workspace:${id}`
    : isTempConvId(sessionId)
      ? undefined
      : (sessionId ?? undefined);
}
