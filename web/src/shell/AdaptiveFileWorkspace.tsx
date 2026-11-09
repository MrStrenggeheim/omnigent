import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

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
  const container = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
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
  }, []);
  const availableWidth = measuredWidth ?? width;
  const split = !isMobile && availableWidth >= SPLIT_MIN_WIDTH && !!explorer;
  const explorerWidth = Math.min(320, Math.max(260, availableWidth * 0.3));

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
          className="flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border"
          style={{ width: explorerWidth }}
        >
          {explorer}
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
