import { type ReactNode, type RefObject, useLayoutEffect, useEffect, useRef } from "react";

/** Scroll open tabs horizontally with a hidden scrollbar. */
export function WorkspaceTabsScroller({
  children,
  onOverflowChange,
  overflowControlRef,
  grow = true,
}: {
  children: ReactNode;
  grow?: boolean;
  onOverflowChange?: (overflow: boolean) => void;
  overflowControlRef?: RefObject<HTMLDivElement | null>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const measure = () => {
      // Compare against the space available with the picker removed, even while
      // it is mounted. Reserving it before this comparison would make it sticky.
      const available = viewport.clientWidth + (overflowControlRef?.current?.offsetWidth ?? 0);
      onOverflowChange?.(content.scrollWidth > available);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children, onOverflowChange, overflowControlRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const wheel = (event: WheelEvent) => {
      if (viewport.scrollWidth <= viewport.clientWidth) return;
      // Leave native horizontal gestures alone. Ctrl-wheel must be non-passive
      // to scroll tabs instead of zooming the page.
      if (event.deltaX && !event.ctrlKey) return;
      const delta = event.deltaX || event.deltaY;
      if (!delta) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      viewport.scrollLeft += delta * unit;
    };
    // Keep the active tab in view as the rail or tab list resizes.
    const observer = new ResizeObserver(() => {
      content
        .querySelector<HTMLElement>('[aria-current="true"], [aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", wheel);
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      data-workspace-tabs-viewport
      className={`no-drag min-w-0 ${grow ? "flex-1" : "flex-[0_1_auto]"} overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
    >
      <div ref={contentRef} data-workspace-tabs-content className="flex w-max items-center gap-0.5">
        {children}
      </div>
    </div>
  );
}
