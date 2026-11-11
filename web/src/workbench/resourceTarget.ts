import type { DockView } from "./dockLayout";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";

/** A resource view without a chat owner stays unowned, even after another chat had focus. */
export function focusedResourceTarget(view: DockView | undefined) {
  const value = view?.resource.workspace;
  const workspace =
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "root" in value &&
    typeof value.root === "string"
      ? (value as WorkbenchWorkspace)
      : undefined;
  const conversationId =
    typeof view?.resource.conversationId === "string" ? view.resource.conversationId : undefined;
  return { workspace, conversationId, folderOwner: workspace?.id ?? conversationId };
}
