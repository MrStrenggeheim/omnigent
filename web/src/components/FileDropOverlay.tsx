// Drop cue for a file drag, portalled into the drop target so it covers exactly
// the region that accepts the drop. pointer-events-none keeps it out of the way.

import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function FileDropOverlay({
  container,
  label = "Drop files here",
  appearance = "surface",
}: {
  container: HTMLElement;
  label?: string;
  /** Outline keeps nested drop targets visible, such as folders in Explorer. */
  appearance?: "surface" | "outline";
}) {
  return createPortal(
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-40 flex justify-center animate-in fade-in-0 duration-150 motion-reduce:animate-none",
        appearance === "surface"
          ? "items-center bg-background/60 backdrop-blur-[2px]"
          : "items-end pb-5",
      )}
      data-testid="file-drop-overlay"
    >
      <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-ring" />
      <span className="max-w-[calc(100%-3rem)] truncate rounded-full border border-border bg-card px-4 py-2 text-ui font-medium text-ring shadow-composer">
        {label}
      </span>
    </div>,
    container,
  );
}
