import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { SidebarToggle, mobileSidebarToggleStyle } from "./SidebarToggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAB_BADGE_BASE } from "./railTabs";
import { useIsMobileViewport } from "@/hooks/useIsMobileViewport";

export interface MobileWorkspaceTab {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: string | number;
  open: () => void;
}

const WorkspaceContext = createContext<{
  tabs: MobileWorkspaceTab[];
  active: string | null;
  select: (id: string) => void;
  open: () => void;
  close: () => void;
  overlay: boolean;
  focusTab: { current: boolean };
} | null>(null);

/** Share tab navigation across the existing workspace surfaces. */
export function MobileWorkspaceProvider({
  sessionId,
  tabs,
  active,
  onClose,
  overlayToggle = true,
  children,
}: {
  sessionId?: string;
  tabs: MobileWorkspaceTab[];
  active: string | null;
  onClose?: () => void;
  /** FileViewer renders its own control through its unsaved-change guard. */
  overlayToggle?: boolean;
  children: ReactNode;
}) {
  const remembered = useRef<{ sessionId?: string; tab: string } | null>(null);
  const focusTab = useRef(false);
  useEffect(() => {
    if (active) remembered.current = { sessionId, tab: active };
  }, [sessionId, active]);
  const select = useCallback(
    (id: string) => {
      const tab = tabs.find((item) => item.id === id);
      if (!tab) return;
      remembered.current = { sessionId, tab: id };
      focusTab.current = true;
      tab.open();
    },
    [tabs, sessionId],
  );
  const open = useCallback(() => {
    const previous = remembered.current?.sessionId === sessionId ? remembered.current?.tab : null;
    const tab = tabs.find((item) => item.id === previous) ?? tabs[0];
    if (tab) select(tab.id);
  }, [sessionId, tabs, select]);
  const close = useCallback(() => onClose?.(), [onClose]);
  const value = useMemo(
    () => ({ tabs, active, select, open, close, focusTab, overlay: !!onClose }),
    [tabs, active, select, open, close, onClose],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {onClose && overlayToggle && <MobileWorkspaceOverlayButton />}
    </WorkspaceContext.Provider>
  );
}

export function MobileWorkspaceButton() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace?.tabs.length) return null;
  const expanded = workspace.active !== null;
  return (
    <SidebarToggle
      side="right"
      expanded={expanded}
      aria-label={expanded ? "Close workspace" : "Open workspace"}
      onClick={expanded ? workspace.close : workspace.open}
      className={workspace.overlay ? "invisible md:hidden" : "md:hidden"}
      aria-hidden={workspace.overlay || undefined}
      tabIndex={workspace.overlay ? -1 : undefined}
    />
  );
}

/** Render outside transformed drawers so scrolling and slides cannot move it. */
export function MobileWorkspaceOverlayButton({
  onClose,
  beforeClose,
}: {
  onClose?: () => void;
  beforeClose?: (close: () => void) => void;
} = {}) {
  const workspace = useContext(WorkspaceContext);
  const isMobile = useIsMobileViewport();
  if (!isMobile || !workspace?.tabs.length) return null;
  const expanded = workspace.active !== null;
  return createPortal(
    <SidebarToggle
      side="right"
      expanded={expanded}
      aria-label={expanded ? "Close workspace" : "Open workspace"}
      onClick={() => {
        if (!expanded) {
          workspace.open();
          return;
        }
        const close = onClose ?? workspace.close;
        if (beforeClose) beforeClose(close);
        else close();
      }}
      className="fixed z-[60] bg-card md:hidden"
      style={mobileSidebarToggleStyle("right")}
      data-workspace-overlay-toggle
    />,
    document.body,
  );
}

export function MobileWorkspaceTabs({
  beforeNavigate,
  onClose,
}: { beforeNavigate?: (navigate: () => void) => void; onClose?: () => void } = {}) {
  const isMobile = useIsMobileViewport();
  const workspace = useContext(WorkspaceContext);
  const selected = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Wait until the pointer's default focus action on the outgoing tab has finished.
    const frame = requestAnimationFrame(() => {
      const tab = selected.current;
      const viewport = scroller.current;
      if (!tab || !viewport) return;
      viewport.scrollLeft +=
        tab.getBoundingClientRect().left -
        viewport.getBoundingClientRect().left -
        (viewport.clientWidth - tab.offsetWidth) / 2;
      if (workspace?.focusTab.current) {
        tab.focus({ preventScroll: true });
        workspace.focusTab.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [workspace?.active, workspace?.focusTab]);
  if (!workspace && onClose)
    return (
      <div className="relative h-14 shrink-0 md:hidden">
        <SidebarToggle
          side="right"
          expanded
          aria-label="Close"
          onClick={onClose}
          className="absolute right-2 top-1.5"
        />
      </div>
    );
  if (!isMobile || !workspace?.tabs.length || !workspace.active) return null;
  return (
    <>
      {beforeNavigate && workspace.overlay && (
        <MobileWorkspaceOverlayButton beforeClose={beforeNavigate} />
      )}
      <Tabs
        value={workspace.active}
        onValueChange={(id) => {
          const navigate = () => workspace.select(id);
          if (beforeNavigate) beforeNavigate(navigate);
          else navigate();
        }}
        className="h-14 shrink-0 gap-0 border-b border-border px-14 md:hidden"
        data-mobile-workspace-tabs
      >
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain px-2 py-1">
          <TabsList aria-label="Workspace" variant="pill">
            {workspace.tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                ref={tab.id === workspace.active ? selected : undefined}
                className="min-h-11 shrink-0 gap-1.5 px-3"
                aria-label={tab.label}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && <span className={TAB_BADGE_BASE}>{tab.badge}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
    </>
  );
}
