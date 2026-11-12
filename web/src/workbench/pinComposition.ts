import {
  removeTerminalLayoutKey,
  terminalLayoutGeometry,
  terminalLayoutKeys,
  type TerminalLayout,
} from "@/lib/terminalSplitLayout";
import { createDockLayout, filterDockLayout, type DockLayout, type DockPane } from "./dockLayout";

/** Empty reservations are real drop surfaces, without duplicating a chat/editor. */
export function withoutEmptyPanes(layout: DockLayout): DockLayout {
  let tree = layout.tree;
  for (const pane of layout.panes)
    if (!pane.viewIds.length && tree !== null) tree = removeTerminalLayoutKey(tree, pane.id);
  const panes = layout.panes.filter((pane) => pane.viewIds.length);
  return {
    ...layout,
    tree,
    panes,
    focusedPaneId: panes.some((pane) => pane.id === layout.focusedPaneId)
      ? layout.focusedPaneId
      : (panes[0]?.id ?? null),
  };
}

/** Keep reserved split geometry; interpolate each chat into its remaining areas. */
export function composePinnedFrame(
  frame: DockLayout,
  pins: DockLayout,
  local: DockLayout,
  sameOwner: boolean,
): DockLayout {
  const pinnedIds = new Set(pins.views.map((view) => view.id));
  const resources = new Map([...local.views, ...pins.views].map((view) => [view.id, view]));
  if (
    sameOwner &&
    frame.views.length === resources.size &&
    frame.views.every((view) => resources.has(view.id))
  ) {
    return { ...frame, views: frame.views.map((view) => resources.get(view.id) ?? view) };
  }
  if (frame.tree === null) return local;
  const framePanes = new Map(frame.panes.map((pane) => [pane.id, pane]));
  const hasPin = (node: TerminalLayout): boolean =>
    typeof node === "string"
      ? framePanes.get(node)!.viewIds.some((id) => pinnedIds.has(id))
      : node.children.some(hasPin);
  const slots: { key: string; area: number; pinned: string[] }[] = [];
  const scan = (node: TerminalLayout, area: number) => {
    if (!hasPin(node)) {
      slots.push({ key: terminalLayoutKeys(node)[0], area, pinned: [] });
    } else if (typeof node === "string") {
      const pane = framePanes.get(node)!;
      if (pane.viewIds.some((id) => !pinnedIds.has(id)))
        slots.push({ key: node, area, pinned: pane.viewIds.filter((id) => pinnedIds.has(id)) });
    } else {
      scan(node.children[0], area * node.ratio);
      scan(node.children[1], area * (1 - node.ratio));
    }
  };
  scan(frame.tree, 1);
  if (slots.some((slot) => !slot.pinned.length)) {
    for (let index = slots.length - 1; index >= 0; index--)
      if (slots[index].pinned.length) slots.splice(index, 1);
  }
  // A fullscreen pin has no spare rectangle: other views share its tab group.
  if (!slots.length && local.views.length) {
    const pane = frame.panes[0];
    slots.push({ key: pane.id, area: 1, pinned: pane.viewIds.filter((id) => pinnedIds.has(id)) });
  }
  const ordered = local.tree
    ? terminalLayoutGeometry(local.tree).panes.map((rect) => rect.key)
    : [];
  const byId = new Map(local.panes.map((pane) => [pane.id, pane]));
  const counts = slots.map(() => 0);
  const largest = slots.map((slot, index) => ({ ...slot, index })).sort((a, b) => b.area - a.area);
  for (let index = 0; index < ordered.length; index++) {
    const target =
      index < slots.length
        ? largest[index].index
        : largest.reduce(
            (best, slot) =>
              slot.area / (counts[slot.index] + 1) > slots[best].area / (counts[best] + 1)
                ? slot.index
                : best,
            largest[0].index,
          );
    counts[target]++;
  }
  const occupied = new Set(frame.panes.map((pane) => pane.id));
  const replacements = new Map<string, { tree: TerminalLayout; panes: DockPane[] }>();
  let offset = 0;
  for (const [index, slot] of slots.entries()) {
    const selectedPanes = ordered.slice(offset, offset + counts[index]);
    offset += counts[index];
    const allowed = new Set(selectedPanes.flatMap((id) => byId.get(id)!.viewIds));
    const part = withoutEmptyPanes(filterDockLayout(local, (view) => allowed.has(view.id)));
    if (slot.pinned.length) {
      const selected = part.panes.find((pane) => pane.id === part.focusedPaneId)?.selectedViewId;
      const viewIds = [...part.panes.flatMap((pane) => pane.viewIds), ...slot.pinned];
      replacements.set(slot.key, {
        tree: slot.key,
        panes: [{ id: slot.key, viewIds, selectedViewId: selected ?? viewIds[0] ?? null }],
      });
      continue;
    }
    if (!part.tree) {
      occupied.add(slot.key);
      replacements.set(slot.key, {
        tree: slot.key,
        panes: [{ id: slot.key, viewIds: slot.pinned, selectedViewId: slot.pinned[0] ?? null }],
      });
      continue;
    }
    const rename = new Map<string, string>();
    for (const [paneIndex, pane] of part.panes.entries()) {
      let id = paneIndex === 0 ? slot.key : pane.id;
      if (paneIndex > 0) while (occupied.has(id)) id = `local:${id}`;
      occupied.add(id);
      rename.set(pane.id, id);
    }
    const remap = (node: TerminalLayout): TerminalLayout =>
      typeof node === "string"
        ? rename.get(node)!
        : { ...node, children: [remap(node.children[0]), remap(node.children[1])] };
    replacements.set(slot.key, {
      tree: remap(part.tree),
      panes: part.panes.map((pane, paneIndex) => ({
        ...pane,
        id: rename.get(pane.id)!,
        viewIds: paneIndex === 0 ? [...pane.viewIds, ...slot.pinned] : pane.viewIds,
      })),
    });
  }
  const panes: DockPane[] = [];
  const build = (node: TerminalLayout): TerminalLayout => {
    const replacement = replacements.get(terminalLayoutKeys(node)[0]);
    if (replacement && (!hasPin(node) || typeof node === "string")) {
      panes.push(...replacement.panes);
      return replacement.tree;
    }
    if (typeof node === "string") {
      const pane = framePanes.get(node)!;
      const ids = pane.viewIds.filter((id) => pinnedIds.has(id));
      panes.push({
        ...pane,
        viewIds: ids,
        selectedViewId: ids.includes(pane.selectedViewId ?? "")
          ? pane.selectedViewId
          : (ids[0] ?? null),
      });
      return node;
    }
    return { ...node, children: [build(node.children[0]), build(node.children[1])] };
  };
  const tree = build(frame.tree);
  const ids = new Set(panes.flatMap((pane) => pane.viewIds));
  const focusedView = local.panes.find((pane) => pane.id === local.focusedPaneId)?.selectedViewId;
  return {
    ...createDockLayout(),
    tree,
    panes,
    views: [...resources.values()].filter((view) => ids.has(view.id)),
    focusedPaneId:
      panes.find((pane) => pane.viewIds.includes(focusedView ?? ""))?.id ?? panes[0]?.id ?? null,
  };
}
