import type { ReactNode } from "react";
import { useWorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import { usePanelFolder, setPanelFolder } from "@/lib/panelFolder";
import { joinBrowseLocation, relativizeToWorkspace } from "@/lib/workspacePaths";
import { BrowseLocationBar } from "./BrowseLocationBar";
import {
  DEFAULT_WORKSPACE_COMPARISON,
  getWorkspaceComparison,
  isRevisionComparison,
  setWorkspaceComparison,
} from "@/lib/workspaceComparison";

/** The same folder identity used by Files, Changes and Search. */
export function PanelFolderBar({
  conversationId,
  fallback,
}: {
  conversationId: string;
  fallback?: ReactNode;
}) {
  const workspace = useWorkbenchWorkspace();
  const owner = workspace?.id ?? conversationId;
  const folder = usePanelFolder(owner, workspace?.root ?? null);
  if (!workspace) return fallback;
  return (
    <BrowseLocationBar
      current={joinBrowseLocation(workspace.root, folder)}
      workspace={workspace.root}
      hostId={workspace.host_id}
      canBrowseOutside={false}
      reach={null}
      onNavigate={(path) => {
        for (const view of ["files", "changes"] as const) {
          const key = { workspaceId: workspace.id, conversationId, view };
          if (isRevisionComparison(getWorkspaceComparison(key)))
            setWorkspaceComparison(key, DEFAULT_WORKSPACE_COMPARISON);
        }
        setPanelFolder(owner, path === workspace.root ? null : path);
        window.dispatchEvent(
          new CustomEvent("omnigent:browse-location-changed", {
            detail: {
              conversationId,
              workspaceId: workspace.id,
              location: relativizeToWorkspace(path, workspace.root),
            },
          }),
        );
      }}
    />
  );
}
