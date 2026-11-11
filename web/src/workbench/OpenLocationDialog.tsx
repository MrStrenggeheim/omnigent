import { authenticatedFetch } from "@/lib/identity";
import { apiErrorFromResponse } from "@/lib/sessionsApi";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import { WorkspaceSelectionDialog } from "@/shell/WorkspaceSelectionDialog";

/** Independent resource selection uses the same host/path picker as the composer. */
export function OpenLocationDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (workspace: WorkbenchWorkspace) => void;
}) {
  return (
    <WorkspaceSelectionDialog
      open={open}
      hostId={null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onConfirm={async ({ hostId, path }) => {
        if (!hostId) throw new Error("Select a host.");
        const response = await authenticatedFetch("/v1/workbench-workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host_id: hostId, root: path }),
        });
        if (!response.ok) throw await apiErrorFromResponse(response);
        const workspace = (await response.json()) as WorkbenchWorkspace;
        if (!workspace.id || workspace.host_id !== hostId || typeof workspace.root !== "string")
          throw new Error("The server returned an invalid workspace identity.");
        onSelect(workspace);
      }}
    />
  );
}
