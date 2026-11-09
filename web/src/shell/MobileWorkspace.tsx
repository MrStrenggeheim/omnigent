import { PlusIcon, TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  covered: boolean;
  headerControl?: ReactNode;
  onNewShell?: () => void;
  newShellDisabled?: boolean;
  focusTab: { current: boolean };
} | null>(null);

/** Share tab navigation across the existing workspace surfaces. */
export function MobileWorkspaceProvider({
  sessionId,
  tabs,
  active,
  onClose,
  onOpen,
  covered = false,
  headerControl,
  onNewShell,
  newShellDisabled = false,
  overlayToggle = true,
  children,
}: {
  sessionId?: string;
  tabs: MobileWorkspaceTab[];
  active: string | null;
  onClose?: () => void;
  /** Reveal Workspace while dismissing another overlay, retaining the active page. */
  onOpen?: () => void;
  covered?: boolean;
  headerControl?: ReactNode;
  onNewShell?: () => void;
  newShellDisabled?: boolean;
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
      onOpen?.();
      tab.open();
    },
    [tabs, sessionId, onOpen],
  );
  const open = useCallback(() => {
    const previous = remembered.current?.sessionId === sessionId ? remembered.current?.tab : null;
    const tab = tabs.find((item) => item.id === previous) ?? tabs[0];
    if (tab) select(tab.id);
  }, [sessionId, tabs, select]);
  const close = useCallback(() => onClose?.(), [onClose]);
  const value = useMemo(
    () => ({
      tabs,
      active,
      select,
      open,
      close,
      focusTab,
      overlay: !!onClose,
      covered,
      headerControl,
      onNewShell,
      newShellDisabled,
    }),
    [
      tabs,
      active,
      select,
      open,
      close,
      onClose,
      covered,
      headerControl,
      onNewShell,
      newShellDisabled,
    ],
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
  const expanded = workspace.active !== null && !workspace.covered;
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
  const expanded = workspace.active !== null && !workspace.covered;
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
      <div className="workspace-control-header relative md:hidden">
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
        className="workspace-control-header flex-row! items-center gap-0 border-b border-border px-14 md:hidden"
        data-mobile-workspace-tabs
      >
        {workspace.headerControl && (
          <div className="min-w-0 shrink-0">{workspace.headerControl}</div>
        )}
        <div
          ref={scroller}
          className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain px-2"
        >
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label="Open workspace panel"
            >
              <PlusIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Panels</DropdownMenuLabel>
            {workspace.tabs.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                onSelect={() => {
                  const navigate = () => workspace.select(tab.id);
                  if (beforeNavigate) beforeNavigate(navigate);
                  else navigate();
                }}
              >
                {tab.icon}
                {tab.label}
              </DropdownMenuItem>
            ))}
            {workspace.onNewShell && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={workspace.newShellDisabled}
                  onSelect={() => {
                    if (beforeNavigate) beforeNavigate(workspace.onNewShell!);
                    else workspace.onNewShell?.();
                  }}
                >
                  <TerminalIcon />
                  New shell
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </Tabs>
    </>
  );
}
