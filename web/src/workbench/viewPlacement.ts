import { dockPaneForView, type DockLayout, type DockPlacement } from "./dockLayout";

/** Sidebar/search navigation keeps independent tool panes on screen. */
export function conversationPlacement(
  layout: DockLayout,
  pinnedIds: readonly string[],
  preferredId?: string,
): DockPlacement {
  const pinned = new Set(pinnedIds);
  const candidates = layout.views.filter(
    (view) => view.kind === "conversation" && !pinned.has(view.id),
  );
  const preferred =
    candidates.find((view) => view.resource.conversationId === preferredId) ??
    candidates.find((view) => dockPaneForView(layout, view.id)?.id === layout.focusedPaneId) ??
    candidates[0];
  if (preferred) return { paneId: dockPaneForView(layout, preferred.id)?.id };
  return layout.views.length ? { paneId: layout.focusedPaneId ?? undefined, edge: "left" } : {};
}
