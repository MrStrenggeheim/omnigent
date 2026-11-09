import {
  createContext,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useResizableColumn } from "@/hooks/useResizableColumn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarPanelIcon } from "./SidebarToggle";

const SPLIT_MIN_WIDTH = 720;
const VISIBILITY_KEY = "omnigent:file-explorer-visible";
const ExplorerVisibility = createContext<{ open: boolean; toggle: () => void } | null>(null);

function readVisibility(): boolean | null {
  try {
    const value = localStorage.getItem(VISIBILITY_KEY);
    return value === "true" ? true : value === "false" ? false : null;
  } catch {
    return null;
  }
}

/** Same sidebar icon and control treatment as the surrounding product. */
export function FileExplorerToggle({ buttonRef }: { buttonRef?: Ref<HTMLButtonElement> }) {
  const explorer = useContext(ExplorerVisibility);
  if (!explorer) return null;
  const label = explorer.open ? "Hide file explorer" : "Show file explorer";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-expanded={explorer.open}
            onClick={explorer.toggle}
          >
            <SidebarPanelIcon side="left" expanded={explorer.open} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Keep the viewer in one column while available rail width controls the Explorer sibling. */
export function AdaptiveFileWorkspace({
  width,
  isMobile,
  explorer,
  children,
  mobileOverlay = false,
}: {
  /** Initial fallback until the actual content width can be measured. */
  width: number;
  isMobile: boolean;
  explorer: ReactNode;
  children: ReactNode;
  mobileOverlay?: boolean;
}) {
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [visible, setVisible] = useState(readVisibility);
  const availableWidth = measuredWidth ?? width;
  const split = !!explorer && (visible ?? (!isMobile && availableWidth >= SPLIT_MIN_WIDTH));
  const toggle = useCallback(() => {
    const next = !split;
    setVisible(next);
    try {
      localStorage.setItem(VISIBILITY_KEY, String(next));
    } catch {
      /* The current view still responds when browser storage is unavailable. */
    }
  }, [split]);
  const visibility = useMemo(
    () => (explorer ? { open: split, toggle } : null),
    [explorer, split, toggle],
  );
  const {
    width: explorerWidth,
    containerRef: container,
    handleProps,
  } = useResizableColumn(
    Math.min(320, Math.max(260, availableWidth * 0.3)),
    180,
    Math.max(180, Math.min(640, availableWidth - (visible === true ? 240 : 360))),
    { preferenceKey: "explorerColumnWidthPx", label: "Resize file explorer", enabled: split },
  );
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const initialWidth = element.getBoundingClientRect().width;
    if (initialWidth > 0) setMeasuredWidth(initialWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === element);
      if (entry) setMeasuredWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);

  return (
    <ExplorerVisibility.Provider value={visibility}>
      <div
        ref={container}
        role="group"
        aria-label="File workspace"
        data-file-workspace-overlay={mobileOverlay || undefined}
        className={`flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden ${mobileOverlay ? "fixed inset-0 z-40 bg-card" : ""}`}
      >
        {explorer && (
          <section
            key="explorer"
            aria-label="File explorer"
            className={`${split ? "flex" : "hidden"} relative min-h-0 shrink-0 flex-col overflow-hidden border-r border-border`}
            hidden={!split}
            aria-hidden={!split || undefined}
            inert={!split}
            style={{ width: explorerWidth }}
          >
            {explorer}
            <div
              {...handleProps}
              className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize transition-colors hover:bg-primary/30 active:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none"
            />
          </section>
        )}
        <section
          key="viewer"
          aria-label="File viewer"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          style={{ minWidth: split ? 240 : undefined }}
        >
          {children}
        </section>
      </div>
    </ExplorerVisibility.Provider>
  );
}
