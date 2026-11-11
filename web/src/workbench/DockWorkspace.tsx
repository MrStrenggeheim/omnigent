import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { MoreHorizontal, Pin, X } from "lucide-react";
import { TooltipButton } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  clampSplitRatio,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  terminalLayoutGeometry,
  type TerminalDivider,
  type TerminalRect,
} from "@/lib/terminalSplitLayout";
import {
  closeDockView,
  dockPaneForView,
  focusDockPane,
  moveDockView,
  resizeDockSplit,
  sameDockResource,
  selectDockView,
  type DockCloseGuard,
  type DockLayout,
  type DockLayoutUpdate,
  type DockPane,
  type DockView,
  type SplitEdge,
} from "./dockLayout";
import "./dockWorkspace.css";

export interface DockViewVisibility {
  visible: boolean;
  focused: boolean;
}

export interface DockWorkspaceProps {
  layout: DockLayout;
  onLayoutChange: (update: DockLayoutUpdate) => void;
  renderView: (view: DockView, state: DockViewVisibility) => ReactNode;
  /** Views in inactive saved layouts remain mounted but hidden. */
  retainedViews?: readonly DockView[];
  /** Changes remount resources at the account/server/client boundary. */
  scopeKey?: string;
  onBeforeClose?: DockCloseGuard;
  /** When supplied, owns the close guard and presentation removal. */
  onCloseView?: (id: string) => boolean | Promise<boolean>;
  pinnedViewIds?: readonly string[];
  onPinView?: (id: string, edge?: SplitEdge) => void;
  onUnpinView?: (id: string) => void;
  /** Override responsive measurement, e.g. for a native mobile wrapper. */
  compact?: boolean;
  className?: string;
}

const edges: SplitEdge[] = ["left", "right", "top", "bottom"];
const fullRect: TerminalRect = { left: 0, top: 0, width: 100, height: 100 };

function rectStyle(rect: TerminalRect, content = false): CSSProperties {
  return {
    left: `${rect.left}%`,
    top: content ? `calc(${rect.top}% + var(--dock-header-height))` : `${rect.top}%`,
    width: `${rect.width}%`,
    height: content
      ? `max(0px, calc(${rect.height}% - var(--dock-header-height)))`
      : `${rect.height}%`,
  };
}

export function DockWorkspace(props: DockWorkspaceProps) {
  return <DockSurface key={props.scopeKey ?? "dock"} {...props} />;
}

function DockSurface(props: DockWorkspaceProps) {
  const { layout, onLayoutChange, renderView, retainedViews = [], pinnedViewIds = [] } = props;
  const prefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [measuredCompact, setMeasuredCompact] = useState(false);
  const compact = props.compact ?? measuredCompact;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const width = root.getBoundingClientRect().width;
      if (width > 0) setMeasuredCompact(width <= 640);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string[]>([]);
  const pending = useRef(new Set<string>());
  const [resize, setResize] = useState<{
    tree: DockLayout["tree"];
    path: number[];
    ratio: number;
  } | null>(null);
  const resizeRef = useRef(resize);
  const preview =
    resize?.tree === layout.tree ? resizeDockSplit(layout, resize.path, resize.ratio) : layout;
  const geometry =
    preview.tree === null ? { panes: [], dividers: [] } : terminalLayoutGeometry(preview.tree);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const close = async (id: string) => {
    if (pending.current.has(id)) return;
    const view = latest.current.layout.views.find((item) => item.id === id);
    if (!view) return;
    pending.current.add(id);
    setClosing([...pending.current]);
    setError(null);
    try {
      if (latest.current.onCloseView) await latest.current.onCloseView(id);
      else {
        const allowed = !latest.current.onBeforeClose || (await latest.current.onBeforeClose(view));
        if (!allowed || !alive.current) return;
        latest.current.onLayoutChange((current) => {
          const target = current.views.find((item) => item.id === id);
          return target && sameDockResource(view, target) ? closeDockView(current, id) : current;
        });
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current.delete(id);
      if (alive.current) setClosing([...pending.current]);
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false);
    const source = active.data.current;
    const destination = over?.data.current;
    if (
      source?.type !== "dock-tab" ||
      !destination ||
      (destination.type !== "dock-tab" && destination.type !== "dock-drop")
    )
      return;
    onLayoutChange((current) =>
      moveDockView(current, source.viewId, {
        paneId: destination.paneId,
        index: destination.index,
        edge: destination.edge,
      }),
    );
  };

  const focus = (paneId: string) =>
    latest.current.onLayoutChange((current) => focusDockPane(current, paneId));
  const select = (id: string) => onLayoutChange((current) => selectDockView(current, id));
  const allViews = new Map(retainedViews.map((view) => [view.id, view]));
  for (const view of layout.views) allViews.set(view.id, view);
  const focusedViewId = layout.panes.find(
    (pane) => pane.id === layout.focusedPaneId,
  )?.selectedViewId;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const hits = pointerWithin(args);
        return hits.length ? hits : closestCenter(args);
      }}
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(false)}
    >
      <div
        ref={rootRef}
        className={`dock-workspace ${props.className ?? ""}`}
        data-compact={compact}
      >
        {compact && layout.views.length > 0 && (
          <div className="dock-mobile-navigation">
            <span>Open views</span>
            <Select value={focusedViewId ?? ""} onValueChange={select}>
              <SelectTrigger aria-label="Open views">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {layout.panes.flatMap((pane) =>
                  pane.viewIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      {allViews.get(id)?.title ?? id}
                      {pinnedViewIds.includes(id) ? " · Pinned" : ""}
                    </SelectItem>
                  )),
                )}
              </SelectContent>
            </Select>
          </div>
        )}
        {error && (
          <div role="alert" className="dock-error">
            {error}
            <TooltipButton type="button" onClick={() => setError(null)}>
              Dismiss
            </TooltipButton>
          </div>
        )}
        <div ref={canvasRef} className="dock-canvas">
          {geometry.panes.map((rect) => {
            const pane = layout.panes.find((item) => item.id === rect.key)!;
            const focused = pane.id === layout.focusedPaneId;
            return (
              <DockPaneChrome
                key={pane.id}
                prefix={prefix}
                pane={pane}
                layout={layout}
                style={rectStyle(compact ? fullRect : rect)}
                hidden={compact && !focused}
                focused={focused}
                dragging={dragging}
                pinnedViewIds={pinnedViewIds}
                closing={closing}
                onSelect={select}
                onFocus={() => focus(pane.id)}
                onClose={(id) => void close(id)}
                onLayoutChange={onLayoutChange}
                onPinView={props.onPinView}
                onUnpinView={props.onUnpinView}
              />
            );
          })}
          <div className="dock-surfaces">
            {[...allViews.values()].map((view) => {
              const pane = dockPaneForView(layout, view.id);
              const focused = pane?.id === layout.focusedPaneId;
              const visible = !!pane && pane.selectedViewId === view.id && (!compact || focused);
              const rect = geometry.panes.find((item) => item.key === pane?.id) ?? fullRect;
              return (
                <DockViewSlot
                  key={view.id}
                  id={`${prefix}-view-${view.id}`}
                  view={view}
                  visible={visible}
                  focused={visible && focused}
                  style={rectStyle(compact ? fullRect : rect, true)}
                  onFocus={() => {
                    if (pane) focus(pane.id);
                  }}
                  renderView={renderView}
                />
              );
            })}
          </div>
          {!compact &&
            geometry.dividers.map((divider) => (
              <DockDivider
                key={divider.path.join("/")}
                divider={divider}
                containerRef={canvasRef}
                onResize={(ratio, final) => {
                  if (final)
                    onLayoutChange((current) => resizeDockSplit(current, divider.path, ratio));
                  else {
                    const draft = { tree: layout.tree, path: divider.path, ratio };
                    resizeRef.current = draft;
                    setResize(draft);
                  }
                }}
                onCommit={() => {
                  const draft = resizeRef.current;
                  resizeRef.current = null;
                  setResize(null);
                  if (draft)
                    onLayoutChange((current) =>
                      current.tree === draft.tree
                        ? resizeDockSplit(current, draft.path, draft.ratio)
                        : current,
                    );
                }}
              />
            ))}
        </div>
      </div>
    </DndContext>
  );
}

/** Every resource has the same parent and key throughout moves, splits and tab changes. */
function DockViewSlot({
  id,
  view,
  visible,
  focused,
  style,
  onFocus,
  renderView,
}: {
  id: string;
  view: DockView;
  visible: boolean;
  focused: boolean;
  style: CSSProperties;
  onFocus: () => void;
  renderView: DockWorkspaceProps["renderView"];
}) {
  const setElement = useCallback(
    (element: HTMLDivElement | null) => {
      element?.toggleAttribute("inert", !visible);
    },
    [visible],
  );
  return (
    <div
      ref={setElement}
      id={id}
      role="tabpanel"
      aria-label={view.title}
      aria-hidden={!visible}
      hidden={!visible}
      className="dock-view-slot"
      data-dock-view={view.id}
      data-focused={focused}
      style={style}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      {renderView(view, { visible, focused })}
    </div>
  );
}

function DockPaneChrome({
  prefix,
  pane,
  layout,
  style,
  hidden,
  focused,
  dragging,
  pinnedViewIds,
  closing,
  onSelect,
  onFocus,
  onClose,
  onLayoutChange,
  onPinView,
  onUnpinView,
}: {
  prefix: string;
  pane: DockPane;
  layout: DockLayout;
  style: CSSProperties;
  hidden: boolean;
  focused: boolean;
  dragging: boolean;
  pinnedViewIds: readonly string[];
  closing: string[];
  onSelect: (id: string) => void;
  onFocus: () => void;
  onClose: (id: string) => void;
  onLayoutChange: DockWorkspaceProps["onLayoutChange"];
  onPinView: DockWorkspaceProps["onPinView"];
  onUnpinView: DockWorkspaceProps["onUnpinView"];
}) {
  const selected = layout.views.find((view) => view.id === pane.selectedViewId)!;
  return (
    <section
      className="dock-pane"
      data-pane-id={pane.id}
      data-focused={focused}
      style={style}
      hidden={hidden}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      <div className="dock-pane-header">
        <div role="tablist" aria-label={`Views in ${pane.id}`} className="dock-tabs">
          <SortableContext
            items={pane.viewIds.map((id) => `view:${id}`)}
            strategy={horizontalListSortingStrategy}
          >
            {pane.viewIds.map((id, tabIndex) => (
              <DockTab
                key={id}
                view={layout.views.find((view) => view.id === id)!}
                pane={pane}
                index={tabIndex}
                prefix={prefix}
                pinned={pinnedViewIds.includes(id)}
                onSelect={() => onSelect(id)}
                onClose={() => onClose(id)}
                closing={closing.includes(id)}
                onStep={(step, reorder) => {
                  if (reorder)
                    onLayoutChange((current) =>
                      moveDockView(current, id, { paneId: pane.id, index: tabIndex + step }),
                    );
                  else {
                    const target =
                      pane.viewIds[(tabIndex + step + pane.viewIds.length) % pane.viewIds.length];
                    onSelect(target);
                    document.getElementById(`${prefix}-tab-${target}`)?.focus();
                  }
                }}
              />
            ))}
          </SortableContext>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TooltipButton type="button" aria-label="Pane actions" className="dock-icon">
              <MoreHorizontal size={16} />
            </TooltipButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DockViewMenuItems
              pane={pane}
              layout={layout}
              selected={selected}
              closing={closing}
              onClose={onClose}
              onLayoutChange={onLayoutChange}
              onPinView={onPinView}
              onUnpinView={onUnpinView}
              pinnedViewIds={pinnedViewIds}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {dragging && (
        <div className="dock-drop-overlay">
          <DockDropZone paneId={pane.id} />
          {edges.map((edge) => (
            <DockDropZone key={edge} paneId={pane.id} edge={edge} />
          ))}
        </div>
      )}
    </section>
  );
}

function DockTab({
  view,
  pane,
  index,
  prefix,
  pinned,
  onSelect,
  onStep,
  onClose,
  closing,
}: {
  view: DockView;
  pane: DockPane;
  index: number;
  prefix: string;
  pinned: boolean;
  onSelect: () => void;
  onStep: (step: number, reorder: boolean) => void;
  onClose: () => void;
  closing: boolean;
}) {
  const { active } = useDndContext();
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({
    id: `view:${view.id}`,
    data: { type: "dock-tab", viewId: view.id, paneId: pane.id, index },
  });
  return (
    <div className="dock-tab-group">
      <button
        type="button"
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        role="tab"
        id={`${prefix}-tab-${view.id}`}
        aria-controls={`${prefix}-view-${view.id}`}
        aria-selected={pane.selectedViewId === view.id}
        tabIndex={pane.selectedViewId === view.id ? 0 : -1}
        className="dock-tab"
        data-dragging={isDragging}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (!active && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            onStep(event.key === "ArrowLeft" ? -1 : 1, event.altKey);
          } else listeners?.onKeyDown?.(event);
        }}
      >
        {pinned && <Pin size={12} aria-label="Kept open across chats" />}
        <span className="dock-tab-label">{view.title}</span>
      </button>
      <TooltipButton
        type="button"
        className="dock-tab-close"
        aria-label={`Close ${view.title}`}
        disabled={closing}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X size={14} />
      </TooltipButton>
    </div>
  );
}

function DockDropZone({ paneId, edge }: { paneId: string; edge?: SplitEdge }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${paneId}:${edge ?? "center"}`,
    data: { type: "dock-drop", paneId, edge },
  });
  return (
    <div
      ref={setNodeRef}
      className="dock-drop-zone"
      data-edge={edge ?? "center"}
      data-over={isOver}
    >
      {isOver && (edge ? `Split ${edge}` : "Move here")}
    </div>
  );
}

function DockDivider({
  divider,
  containerRef,
  onResize,
  onCommit,
}: {
  divider: TerminalDivider;
  containerRef: RefObject<HTMLDivElement | null>;
  onResize: (ratio: number, final: boolean) => void;
  onCommit: () => void;
}) {
  const { axis, area, ratio } = divider;
  const columns = axis === "columns";
  const offset = columns ? area.left + area.width * ratio : area.top + area.height * ratio;
  return (
    <div
      role="separator"
      aria-label="Resize panes"
      aria-orientation={columns ? "vertical" : "horizontal"}
      aria-valuemin={MIN_SPLIT_RATIO * 100}
      aria-valuemax={MAX_SPLIT_RATIO * 100}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      className="dock-divider"
      style={
        columns
          ? {
              left: `calc(${offset}% - 3px)`,
              top: `${area.top}%`,
              height: `${area.height}%`,
              width: 7,
              cursor: "col-resize",
            }
          : {
              top: `calc(${offset}% - 3px)`,
              left: `${area.left}%`,
              width: `${area.width}%`,
              height: 7,
              cursor: "row-resize",
            }
      }
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || !containerRef.current)
          return;
        const bounds = containerRef.current.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const position = columns
          ? ((event.clientX - bounds.left) / bounds.width) * 100
          : ((event.clientY - bounds.top) / bounds.height) * 100;
        onResize(
          clampSplitRatio(
            columns ? (position - area.left) / area.width : (position - area.top) / area.height,
          ),
          false,
        );
      }}
      onPointerUp={onCommit}
      onPointerCancel={onCommit}
      onLostPointerCapture={onCommit}
      onKeyDown={(event) => {
        const step = columns
          ? { ArrowLeft: -1, ArrowRight: 1 }[event.key]
          : { ArrowUp: -1, ArrowDown: 1 }[event.key];
        if (step !== undefined) {
          event.preventDefault();
          onResize(ratio + step * 0.05, true);
        }
      }}
    />
  );
}

function DockViewMenuItems({
  pane,
  layout,
  selected,
  closing,
  onClose,
  onLayoutChange,
  onPinView,
  onUnpinView,
  pinnedViewIds,
}: Pick<
  Parameters<typeof DockPaneChrome>[0],
  | "pane"
  | "layout"
  | "closing"
  | "onClose"
  | "onLayoutChange"
  | "onPinView"
  | "onUnpinView"
  | "pinnedViewIds"
> & { selected: DockView }) {
  const index = pane.viewIds.indexOf(selected.id);
  const move = (paneId: string, edge?: SplitEdge, targetIndex?: number) =>
    onLayoutChange((current) =>
      moveDockView(current, selected.id, { paneId, edge, index: targetIndex }),
    );
  return (
    <>
      <DropdownMenuItem disabled={index === 0} onSelect={() => move(pane.id, undefined, index - 1)}>
        Move tab left
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={index === pane.viewIds.length - 1}
        onSelect={() => move(pane.id, undefined, index + 1)}
      >
        Move tab right
      </DropdownMenuItem>
      {edges.map((edge) => (
        <DropdownMenuItem
          key={edge}
          disabled={pane.viewIds.length < 2}
          onSelect={() => move(pane.id, edge)}
        >
          Split {edge}
        </DropdownMenuItem>
      ))}
      {layout.panes
        .filter((target) => target.id !== pane.id)
        .map((target) => (
          <DropdownMenuItem key={target.id} onSelect={() => move(target.id)}>
            Move to{" "}
            {layout.views.find((view) => view.id === target.selectedViewId)?.title ?? target.id}
          </DropdownMenuItem>
        ))}
      {(onPinView || onUnpinView) && <DropdownMenuSeparator />}
      {pinnedViewIds.includes(selected.id)
        ? onUnpinView && (
            <DropdownMenuItem onSelect={() => onUnpinView(selected.id)}>
              Unpin from shared area
            </DropdownMenuItem>
          )
        : onPinView && (
            <DropdownMenuItem onSelect={() => onPinView(selected.id)}>
              Keep open across chats
            </DropdownMenuItem>
          )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={closing.includes(selected.id)}
        onSelect={() => onClose(selected.id)}
      >
        Close view
      </DropdownMenuItem>
    </>
  );
}
