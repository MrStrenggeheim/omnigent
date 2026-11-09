import { type ReactNode, useLayoutEffect, useState } from "react";
import { useResizableColumn } from "@/hooks/useResizableColumn";

const SPLIT_MIN_WIDTH = 720;

/** Keep the viewer in one column while available rail width controls the Explorer sibling. */
export function AdaptiveFileWorkspace({
  width,
  isMobile,
  explorer,
  children,
}: {
  /** Initial fallback until the actual content width can be measured. */
  width: number;
  isMobile: boolean;
  explorer: ReactNode;
  children: ReactNode;
}) {
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const availableWidth = measuredWidth ?? width;
  const split = !isMobile && availableWidth >= SPLIT_MIN_WIDTH && !!explorer;
  const {
    width: explorerWidth,
    containerRef: container,
    handleProps,
  } = useResizableColumn(
    Math.min(320, Math.max(260, availableWidth * 0.3)),
    260,
    Math.max(260, Math.min(640, availableWidth - 360)),
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
    <div
      ref={container}
      role="group"
      aria-label="File workspace"
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {split && (
        <section
          key="explorer"
          aria-label="File explorer"
          className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border"
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
      >
        {children}
      </section>
    </div>
  );
}
