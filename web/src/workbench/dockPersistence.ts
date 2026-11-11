import {
  clampSplitRatio,
  replaceTerminalLayoutKey,
  terminalLayoutGeometry,
} from "@/lib/terminalSplitLayout";
import {
  addDockView,
  createDockLayout,
  dockPaneForView,
  filterDockLayout,
  parseDockLayout,
  sameDockResource,
  type DockLayout,
  type DockView,
  type SplitEdge,
} from "./dockLayout";

export interface DockScope {
  accountId: string;
  serverId: string;
  clientId: string;
}

export interface DockPersistence {
  version: 1;
  shared: DockLayout;
  chats: { conversationId: string; layout: DockLayout }[];
  pins: DockLayout;
  pinEdge: SplitEdge;
  /** Fraction reserved for global pins. */
  pinRatio: number;
  activeConversationId: string | null;
  focusedViewId: string | null;
}

export function dockStorageKey(scope: DockScope): string {
  if (
    ![scope.accountId, scope.serverId, scope.clientId].every(
      (part) => typeof part === "string" && part.length > 0,
    )
  )
    throw new Error("Dock scope requires account, server and client IDs");
  return `omnigent:dock:v1:${JSON.stringify([scope.accountId, scope.serverId, scope.clientId])}`;
}

export function createDockPersistence(initialLayout = createDockLayout()): DockPersistence {
  if (!parseDockLayout(initialLayout)) throw new Error("Invalid initial dock layout");
  return {
    version: 1,
    shared: initialLayout,
    chats: [],
    pins: createDockLayout(),
    pinEdge: "right",
    pinRatio: 0.25,
    activeConversationId: null,
    focusedViewId: null,
  };
}

export function localDockLayout(state: DockPersistence): DockLayout {
  return (
    state.chats.find((chat) => chat.conversationId === state.activeConversationId)?.layout ??
    state.shared
  );
}

function withLocal(state: DockPersistence, layout: DockLayout): DockPersistence {
  const saved = state.chats.some((chat) => chat.conversationId === state.activeConversationId);
  return saved
    ? {
        ...state,
        chats: state.chats.map((chat) =>
          chat.conversationId === state.activeConversationId ? { ...chat, layout } : chat,
        ),
      }
    : { ...state, shared: layout };
}

/** Saved arrangements share view instances, never conflicting resource identities. */
export function retainedDockViews(state: DockPersistence): DockView[] {
  const views = new Map<string, DockView>();
  for (const layout of [state.shared, ...state.chats.map((chat) => chat.layout), state.pins]) {
    for (const view of layout.views) {
      const existing = views.get(view.id);
      if (existing && !sameDockResource(existing, view))
        throw new Error(`Dock view ID collision: ${view.id}`);
      views.set(view.id, view);
    }
  }
  return [...views.values()];
}

/** Pins win duplicate view IDs; pane-name collisions are deterministically renamed. */
export function composeDockLayout(state: DockPersistence): DockLayout {
  retainedDockViews(state);
  const pinned = new Set(state.pins.views.map((view) => view.id));
  const local = filterDockLayout(localDockLayout(state), (view) => !pinned.has(view.id));
  let pins = state.pins;
  const used = new Set([...local.panes, ...pins.panes].map((pane) => pane.id));
  for (const pane of pins.panes) {
    if (!local.panes.some((item) => item.id === pane.id)) continue;
    let id = `pin:${pane.id}`;
    while (used.has(id)) id = `pin:${id}`;
    used.add(id);
    pins = {
      ...pins,
      tree: pins.tree === null ? null : replaceTerminalLayoutKey(pins.tree, pane.id, id),
      panes: pins.panes.map((item) => (item.id === pane.id ? { ...item, id } : item)),
      focusedPaneId: pins.focusedPaneId === pane.id ? id : pins.focusedPaneId,
    };
  }
  const before = state.pinEdge === "left" || state.pinEdge === "top";
  const layout: DockLayout = {
    version: 1,
    tree:
      local.tree === null
        ? pins.tree
        : pins.tree === null
          ? local.tree
          : {
              axis: state.pinEdge === "left" || state.pinEdge === "right" ? "columns" : "rows",
              ratio: before ? state.pinRatio : 1 - state.pinRatio,
              children: before ? [pins.tree, local.tree] : [local.tree, pins.tree],
            },
    panes: [...local.panes, ...pins.panes],
    views: [...local.views, ...pins.views],
    focusedPaneId: local.focusedPaneId ?? pins.focusedPaneId,
  };
  const focused = state.focusedViewId && dockPaneForView(layout, state.focusedViewId);
  return focused ? { ...layout, focusedPaneId: focused.id } : layout;
}

/** Editing a composed layout never writes another conversation's snapshot. */
export function applyDockLayout(state: DockPersistence, layout: DockLayout): DockPersistence {
  if (!parseDockLayout(layout)) throw new Error("Invalid dock layout");
  const pinned = new Set(state.pins.views.map((view) => view.id));
  const pins = filterDockLayout(layout, (view) => pinned.has(view.id));
  const local = filterDockLayout(layout, (view) => !pinned.has(view.id));
  let pinEdge = state.pinEdge;
  let pinRatio = state.pinRatio;
  // A mixed tab group stays in its respective area; an outer split moves the reservation.
  if (
    layout.tree !== null &&
    typeof layout.tree !== "string" &&
    pins.tree !== null &&
    local.tree !== null
  ) {
    const geometry = terminalLayoutGeometry(layout.tree);
    const pinRects = geometry.panes.filter((rect) =>
      pins.panes.some((pane) => pane.id === rect.key),
    );
    const localRects = geometry.panes.filter((rect) =>
      local.panes.some((pane) => pane.id === rect.key),
    );
    if (pinRects.length && localRects.length) {
      const min = (rects: typeof pinRects, key: "left" | "top") =>
        Math.min(...rects.map((rect) => rect[key]));
      const max = (rects: typeof pinRects, axis: "left" | "top", size: "width" | "height") =>
        Math.max(...rects.map((rect) => rect[axis] + rect[size]));
      if (max(pinRects, "left", "width") <= min(localRects, "left")) {
        pinEdge = "left";
        pinRatio = max(pinRects, "left", "width") / 100;
      } else if (min(pinRects, "left") >= max(localRects, "left", "width")) {
        pinEdge = "right";
        pinRatio = 1 - min(pinRects, "left") / 100;
      } else if (max(pinRects, "top", "height") <= min(localRects, "top")) {
        pinEdge = "top";
        pinRatio = max(pinRects, "top", "height") / 100;
      } else if (min(pinRects, "top") >= max(localRects, "top", "height")) {
        pinEdge = "bottom";
        pinRatio = 1 - min(pinRects, "top") / 100;
      }
    }
  }
  const next = withLocal(
    {
      ...state,
      pins,
      pinEdge,
      pinRatio: clampSplitRatio(pinRatio),
      focusedViewId:
        layout.panes.find((pane) => pane.id === layout.focusedPaneId)?.selectedViewId ?? null,
    },
    local,
  );
  retainedDockViews(next);
  return next;
}

export function saveDockChatLayout(
  state: DockPersistence,
  conversationId: string,
): DockPersistence {
  if (!conversationId) throw new Error("A conversation ID is required");
  const layout = filterDockLayout(
    composeDockLayout(state),
    (view) => !state.pins.views.some((pin) => pin.id === view.id),
  );
  return {
    ...state,
    activeConversationId: conversationId,
    chats: [
      ...state.chats.filter((chat) => chat.conversationId !== conversationId),
      { conversationId, layout },
    ],
  };
}

export function pinDockView(
  state: DockPersistence,
  viewId: string,
  edge: SplitEdge = state.pinEdge,
): DockPersistence {
  const view = composeDockLayout(state).views.find((item) => item.id === viewId);
  if (!view) return state;
  const pins = addDockView(state.pins, view);
  return { ...state, pins, pinEdge: edge };
}

export function unpinDockView(state: DockPersistence, viewId: string): DockPersistence {
  const view = state.pins.views.find((item) => item.id === viewId);
  if (!view) return state;
  const pins = filterDockLayout(state.pins, (item) => item.id !== viewId);
  return withLocal({ ...state, pins }, addDockView(localDockLayout(state), view));
}

export function parseDockPersistence(raw: string): DockPersistence | undefined {
  try {
    const value = JSON.parse(raw) as DockPersistence;
    if (
      !value ||
      value.version !== 1 ||
      !parseDockLayout(value.shared) ||
      !parseDockLayout(value.pins) ||
      !Array.isArray(value.chats) ||
      !["left", "right", "top", "bottom"].includes(value.pinEdge) ||
      !Number.isFinite(value.pinRatio) ||
      clampSplitRatio(value.pinRatio) !== value.pinRatio ||
      !(value.activeConversationId === null || typeof value.activeConversationId === "string") ||
      !(value.focusedViewId === null || typeof value.focusedViewId === "string")
    )
      return undefined;
    const ids = new Set<string>();
    for (const chat of value.chats) {
      if (
        !chat ||
        typeof chat.conversationId !== "string" ||
        !chat.conversationId ||
        ids.has(chat.conversationId) ||
        !parseDockLayout(chat.layout)
      )
        return undefined;
      ids.add(chat.conversationId);
    }
    retainedDockViews(value);
    return value;
  } catch {
    return undefined;
  }
}
