import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDockView,
  closeDockView,
  parseDockLayout,
  sameDockResource,
  selectDockView,
  type DockCloseGuard,
  type DockLayout,
  type DockLayoutUpdate,
  type DockPlacement,
  type DockView,
  type SplitEdge,
} from "./dockLayout";
import {
  applyDockLayout,
  composeDockLayout,
  createDockPersistence,
  dockStorageKey,
  parseDockPersistence,
  pinDockView,
  retainedDockViews,
  saveDockChatLayout,
  unpinDockView,
  type DockPersistence,
  type DockScope,
} from "./dockPersistence";

export type { DockScope } from "./dockPersistence";
export interface DockStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface UseDockLayoutOptions {
  scope: DockScope;
  initialLayout?: DockLayout;
  /** null disables persistence; undefined uses localStorage. */
  storage?: DockStorage | null;
  onBeforeClose?: DockCloseGuard;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function loadSession(
  key: string,
  initialLayout: DockLayout | undefined,
  storage: DockStorage | null | undefined,
) {
  let state = createDockPersistence(initialLayout);
  let error: Error | null = null;
  let resolvedStorage = storage;
  try {
    if (resolvedStorage === undefined)
      resolvedStorage = typeof window === "undefined" ? null : window.localStorage;
    const raw = resolvedStorage?.getItem(key);
    if (raw != null) {
      const parsed = parseDockPersistence(raw);
      if (!parsed) throw new Error("Saved dock layout is invalid or uses an unsupported version");
      state = parsed;
    }
  } catch (cause) {
    error = asError(cause);
  }
  return {
    key,
    state,
    error,
    storage: resolvedStorage ?? null,
    suppliedStorage: storage,
    generation: {},
  };
}

/** Scope changes reset synchronously so one account never renders another's views. */
export function useDockLayout({
  scope,
  initialLayout,
  storage,
  onBeforeClose,
}: UseDockLayoutOptions) {
  const scopeKey = dockStorageKey(scope);
  const [session, setSession] = useState(() => loadSession(scopeKey, initialLayout, storage));
  const current = useRef(session);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const guard = useRef(onBeforeClose);
  guard.current = onBeforeClose;
  if (session.key !== scopeKey || session.suppliedStorage !== storage) {
    const next = loadSession(scopeKey, initialLayout, storage);
    current.current = next;
    setSession(next);
  } else {
    current.current = session;
  }
  const navigation = useRef(0);
  const closing = useRef(new Map<string, Promise<boolean>>());

  const commit = useCallback(
    (change: (state: DockPersistence) => DockPersistence) => {
      const previous = current.current;
      if (!alive.current || previous.key !== scopeKey || previous.suppliedStorage !== storage)
        return;
      const state = change(previous.state);
      if (state === previous.state) return;
      retainedDockViews(state);
      let error: Error | null = null;
      try {
        previous.storage?.setItem(scopeKey, JSON.stringify(state));
      } catch (cause) {
        error = asError(cause);
      }
      const next = { ...previous, state, error };
      current.current = next;
      setSession(next);
    },
    [scopeKey, storage],
  );

  const setLayout = useCallback(
    (update: DockLayoutUpdate) => {
      commit((state) => {
        const layout = composeDockLayout(state);
        const next = typeof update === "function" ? update(layout) : update;
        return next === layout ? state : applyDockLayout(state, next);
      });
    },
    [commit],
  );

  const addView = useCallback(
    (view: DockView, placement?: DockPlacement) => {
      setLayout((layout) => addDockView(layout, view, placement));
    },
    [setLayout],
  );
  const focusView = useCallback(
    (id: string) => {
      setLayout((layout) => selectDockView(layout, id));
    },
    [setLayout],
  );

  const closeView = useCallback(
    (id: string): Promise<boolean> => {
      const lockKey = JSON.stringify([scopeKey, id]);
      const pending = closing.current.get(lockKey);
      if (pending) return pending;
      const captured = current.current;
      const view = composeDockLayout(captured.state).views.find((item) => item.id === id);
      if (!view || captured.key !== scopeKey) return Promise.resolve(false);
      const task = (async () => {
        if (guard.current && !(await guard.current(view))) return false;
        const latest = current.current;
        if (!alive.current || latest.generation !== captured.generation) return false;
        const stillOpen = composeDockLayout(latest.state).views.find((item) => item.id === id);
        if (!stillOpen || !sameDockResource(view, stillOpen)) return false;
        setLayout((layout) => closeDockView(layout, id));
        return true;
      })();
      closing.current.set(lockKey, task);
      void task.then(
        () => closing.current.delete(lockKey),
        () => closing.current.delete(lockKey),
      );
      return task;
    },
    [scopeKey, setLayout],
  );

  const updateView = useCallback(
    async (id: string, patch: Partial<Omit<DockView, "id">>): Promise<boolean> => {
      const captured = current.current;
      if (captured.key !== scopeKey) return false;
      const view = retainedDockViews(captured.state).find((item) => item.id === id);
      if (!view) return false;
      const updated = { ...view, ...patch, id };
      const replacing = !sameDockResource(view, updated);
      if (replacing && guard.current && !(await guard.current(view))) return false;
      if (!alive.current || current.current !== captured) return false;
      const replace = (layout: DockLayout): DockLayout => {
        const next = {
          ...layout,
          views: layout.views.map((item) => (item.id === id ? updated : item)),
        };
        if (!parseDockLayout(next)) throw new Error("Invalid dock view update");
        return next;
      };
      commit((state) => ({
        ...state,
        shared: replace(state.shared),
        pins: replace(state.pins),
        chats: state.chats.map((chat) => ({ ...chat, layout: replace(chat.layout) })),
      }));
      return true;
    },
    [commit, scopeKey],
  );

  const navigateConversation = useCallback(
    async (id: string | null): Promise<boolean> => {
      if (id === "") throw new Error("A conversation ID is required");
      const captured = current.current;
      if (captured.key !== scopeKey) return false;
      const request = ++navigation.current;
      const next = { ...captured.state, activeConversationId: id, focusedViewId: null };
      const restored = composeDockLayout(next);
      for (const view of composeDockLayout(captured.state).views) {
        if (
          !restored.views.some((item) => item.id === view.id) &&
          guard.current &&
          // Dirty-resource dialogs must run one at a time.
          // eslint-disable-next-line no-await-in-loop
          !(await guard.current(view))
        )
          return false;
        if (!alive.current || request !== navigation.current || current.current !== captured)
          return false;
      }
      commit(() => next);
      return true;
    },
    [commit, scopeKey],
  );

  const useSharedLayout = useCallback(() => navigateConversation(null), [navigateConversation]);
  const saveChatLayout = useCallback(
    (id: string) => commit((state) => saveDockChatLayout(state, id)),
    [commit],
  );
  const pinView = useCallback(
    (id: string, edge?: SplitEdge) => commit((state) => pinDockView(state, id, edge)),
    [commit],
  );
  const unpinView = useCallback(
    (id: string) => commit((state) => unpinDockView(state, id)),
    [commit],
  );
  const state = current.current.state;
  return {
    scopeKey,
    layout: composeDockLayout(state),
    retainedViews: retainedDockViews(state),
    pinnedViewIds: state.pins.views.map((view) => view.id),
    activeConversationId: state.activeConversationId,
    hasChatLayout: state.chats.some((chat) => chat.conversationId === state.activeConversationId),
    error: current.current.error,
    setLayout,
    addView,
    focusView,
    closeView,
    updateView,
    navigateConversation,
    useSharedLayout,
    saveChatLayout,
    pinView,
    unpinView,
  };
}
