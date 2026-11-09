import { usePanelFolder } from "./panelFolder";
import {
  useWorkbenchWorkspace,
  queryIdentity,
  type WorkspaceResourceTarget,
} from "./workbenchWorkspace";
/** Folder scope is shared with Files/Changes without changing workspace ownership. */
export function usePullRequestWorkspace(conversationId?: string) {
  const workspace = useWorkbenchWorkspace();
  const scopePath = usePanelFolder(workspace?.id ?? conversationId, workspace?.root ?? null);
  return workspace ? { ...workspace, scopePath } : workspace;
}
export function pullRequestIdentity(workspace: WorkspaceResourceTarget, conversationId?: string) {
  const identity = queryIdentity(workspace, conversationId);
  const scope = typeof workspace === "object" ? workspace?.scopePath : undefined;
  return identity && scope ? `${identity}:github-folder:${JSON.stringify(scope)}` : identity;
}
export function pullRequestUrl(url: string, workspace: WorkspaceResourceTarget): string {
  const scope = typeof workspace === "object" ? workspace?.scopePath : undefined;
  return scope ? `${url}${url.includes("?") ? "&" : "?"}folder=${encodeURIComponent(scope)}` : url;
}
