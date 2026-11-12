import { terminalLayoutGeometry, type TerminalRect } from "@/lib/terminalSplitLayout";
import { dockPaneForView, moveDockView, type DockLayout, type DockPlacement } from "./dockLayout";

export interface DockDropTarget extends DockPlacement {
  paneId: string;
  /** Boundary in the displayed strip, before removing the dragged tab. */
  tabIndex?: number;
}

export function tabDropTarget(
  paneId: string,
  index: number,
  source?: { paneId: string; index: number },
): DockDropTarget {
  return {
    paneId,
    tabIndex: index,
    index: index - (source?.paneId === paneId && source.index < index ? 1 : 0),
  };
}

/** Preview the destination after removing the source and collapsing its empty branch. */
export function projectedDockRect(
  layout: DockLayout,
  target: DockDropTarget,
  viewId?: string,
): TerminalRect | undefined {
  const projected = viewId ? moveDockView(layout, viewId, target) : layout;
  const paneId = viewId ? dockPaneForView(projected, viewId)?.id : target.paneId;
  if (!projected.tree) return;
  const rect = terminalLayoutGeometry(projected.tree).panes.find((pane) => pane.key === paneId);
  if (!rect || viewId || !target.edge) return rect;
  const { left, top, width, height } = rect;
  switch (target.edge) {
    case "left":
      return { left, top, width: width / 2, height };
    case "right":
      return { left: left + width / 2, top, width: width / 2, height };
    case "top":
      return { left, top, width, height: height / 2 };
    case "bottom":
      return { left, top: top + height / 2, width, height: height / 2 };
  }
}
