import { describe, expect, it } from "vitest";
import { terminalLayoutGeometry } from "@/lib/terminalSplitLayout";
import {
  addDockView,
  createDockLayout,
  dockPaneForView,
  moveDockView,
  resizeDockSplit,
  type DockView,
} from "./dockLayout";
import { projectedDockRect, tabDropTarget } from "./dockDropPlacement";

const view = (id: string): DockView => ({
  id,
  kind: "editor",
  title: id,
  resource: { path: `/${id}` },
});

describe("dock drop placement", () => {
  it.each([
    ["main", 0, "main", 1, 0],
    ["main", 2, "main", 0, 1],
    ["main", 1, "main", 1, 1],
    ["other", 2, "main", 0, 2],
  ])(
    "converts the displayed %s boundary %s to final order",
    (paneId, index, sourcePane, sourceIndex, expected) => {
      expect(
        tabDropTarget(String(paneId), Number(index), {
          paneId: String(sourcePane),
          index: Number(sourceIndex),
        }),
      ).toEqual({ paneId, index: expected, tabIndex: index });
    },
  );

  it.each(["left", "right", "top", "bottom"] as const)(
    "previews the actual %s split after the source branch collapses",
    (edge) => {
      const layout = resizeDockSplit(
        addDockView(createDockLayout([view("a")]), view("b"), { edge: "right" }),
        [],
        0.7,
      );
      const paneId = dockPaneForView(layout, "b")!.id;
      const target = { paneId, edge };
      const final = moveDockView(layout, "a", target);
      const destination = dockPaneForView(final, "a")!;
      const actual = terminalLayoutGeometry(final.tree!).panes.find(
        (rect) => rect.key === destination.id,
      );
      expect(projectedDockRect(layout, target, "a")).toEqual(actual);
      expect(projectedDockRect(layout, target, "a")).toMatchObject(
        edge === "left" || edge === "right"
          ? { width: 50, height: 100 }
          : { width: 100, height: 50 },
      );
    },
  );

  it.each(["left", "right", "top", "bottom"] as const)(
    "previews sidebar %s drops in the target pane's exact half",
    (edge) => {
      const layout = resizeDockSplit(
        addDockView(createDockLayout([view("a")]), view("b"), { edge: "right" }),
        [],
        0.6,
      );
      const paneId = dockPaneForView(layout, "b")!.id;
      const final = addDockView(layout, view("sidebar"), { paneId, edge });
      const destination = dockPaneForView(final, "sidebar")!;
      const { key: _key, ...actual } = terminalLayoutGeometry(final.tree!).panes.find(
        (rect) => rect.key === destination.id,
      )!;
      expect(projectedDockRect(layout, { paneId, edge })).toEqual(actual);
    },
  );

  it("uses the full same-pane center footprint, including for a single tab", () => {
    const layout = createDockLayout([view("a")]);
    expect(projectedDockRect(layout, { paneId: "main" }, "a")).toMatchObject({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(projectedDockRect(layout, { paneId: "missing" })).toBeUndefined();
  });
});
