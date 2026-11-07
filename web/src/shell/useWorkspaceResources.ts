import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  findAgentTerminal,
  inventoryTerminals,
  terminalTabKey,
  useTerminals,
} from "@/hooks/useTerminals";
import {
  useWorkspaceChangedFiles,
  useWorkspaceEnvironment,
  useWorkspaceGitChanges,
} from "@/hooks/useWorkspaceChangedFiles";
import { isEditorLevel } from "@/lib/permissionsApi";
import { getExplorerGitScope, subscribeExplorerGitScopes } from "@/lib/explorerGitScope";
import {
  readFilesPanelPreferences,
  subscribeFilesPanelPreferences,
} from "@/lib/filesPanelPreferences";

function readShowAgentChanges() {
  return readFilesPanelPreferences().showAgentChanges;
}

/** Shared discovery for the full-session shell and grid workspaces. */
export function useWorkspaceResources({
  sessionId,
  permissionLevel,
  shareWorkspaceFiles,
  terminalFirst = false,
  terminalPending = false,
}: {
  sessionId: string | undefined;
  permissionLevel: number | null;
  shareWorkspaceFiles?: boolean;
  terminalFirst?: boolean;
  terminalPending?: boolean;
}) {
  // View grants don't include files. Unknown levels stay permissive; the server enforces access.
  const canBrowseWorkspace = isEditorLevel(permissionLevel) || shareWorkspaceFiles === true;
  const environmentQuery = useWorkspaceEnvironment(sessionId, { enabled: canBrowseWorkspace });
  const scope = useSyncExternalStore(
    subscribeExplorerGitScopes,
    () => getExplorerGitScope(sessionId),
    () => getExplorerGitScope(undefined),
  );
  const showAgentChanges = useSyncExternalStore(
    subscribeFilesPanelPreferences,
    readShowAgentChanges,
    () => false,
  );
  const gitChanges = useWorkspaceGitChanges(sessionId, {
    ...scope,
    enabled: canBrowseWorkspace,
  });
  const agentChanges = useWorkspaceChangedFiles(sessionId, {
    enabled: canBrowseWorkspace && showAgentChanges,
  });
  const changedPaths = useMemo(
    () =>
      new Map(
        [
          ...(showAgentChanges ? (agentChanges.data?.data ?? []) : []),
          ...(gitChanges.data?.data ?? []),
        ].map((file) => [file.path, file]),
      ),
    [gitChanges.data, agentChanges.data, showAgentChanges],
  );
  const isChangedPath = useCallback((path: string) => changedPaths.has(path), [changedPaths]);
  const { terminals } = useTerminals(sessionId ?? null, { reconcileWhilePending: terminalPending });
  const agentTerminal = useMemo(() => findAgentTerminal(terminals), [terminals]);
  // Hide the agent terminal from shells only when it has its own Terminal view.
  const openTerminals = useMemo(
    () => inventoryTerminals(terminals, terminalFirst).map(terminalTabKey),
    [terminals, terminalFirst],
  );
  return {
    canBrowseWorkspace,
    environmentQuery,
    showFilesPanel: canBrowseWorkspace && environmentQuery.data?.available !== false,
    changedCount: changedPaths.size,
    isChangedPath,
    terminals,
    agentTerminal,
    openTerminals,
  };
}
