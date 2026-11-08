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
import { PanelRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  focusTab: { current: boolean };
} | null>(null);

/** Share tab navigation across the existing workspace surfaces. */
export function MobileWorkspaceProvider({
  sessionId,
  tabs,
  active,
  children,
}: {
  sessionId?: string;
  tabs: MobileWorkspaceTab[];
  active: string | null;
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
  const value = useMemo(
    () => ({ tabs, active, select, open, focusTab }),
    [tabs, active, select, open],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function MobileWorkspaceButton() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace?.tabs.length) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Open workspace"
      aria-expanded={workspace.active !== null}
      onClick={workspace.open}
      className="size-11 shrink-0 text-muted-foreground hover:text-foreground md:hidden"
    >
      <PanelRightIcon className="size-5" />
    </Button>
  );
}

export function MobileWorkspaceTabs({
  beforeNavigate,
}: { beforeNavigate?: (navigate: () => void) => void } = {}) {
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
  if (!isMobile || !workspace?.tabs.length || !workspace.active) return null;
  return (
    <Tabs
      value={workspace.active}
      onValueChange={(id) => {
        const navigate = () => workspace.select(id);
        if (beforeNavigate) beforeNavigate(navigate);
        else navigate();
      }}
      className="shrink-0 gap-0 border-b border-border md:hidden"
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
  );
}
