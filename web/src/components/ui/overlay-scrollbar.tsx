import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** The transcript's slim thumb, shared by native scroll surfaces. */
export const ScrollbarThumb = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & {
    orientation?: "vertical" | "horizontal";
    dragging?: boolean;
  }
>(function ScrollbarThumb({ orientation = "vertical", dragging, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "pointer-events-auto absolute cursor-default touch-none rounded-full bg-foreground/20 transition-[width,height,background-color] duration-150 hover:bg-foreground/40",
        orientation === "vertical" ? "right-0.5 w-1.5 hover:w-2.5" : "bottom-0.5 h-1.5 hover:h-2.5",
        dragging && "bg-foreground/50",
        dragging && (orientation === "vertical" ? "w-2.5" : "h-2.5"),
        className,
      )}
      {...props}
    />
  );
});

export function scrollbarGeometry(
  viewport: number,
  content: number,
  track: number,
  minimumThumb = 56,
) {
  if (viewport <= 0 || content <= 0 || track <= 0) return { range: 0, thumb: 0, travel: 0 };
  const range = Math.max(0, content - viewport);
  const thumb = Math.max(
    0,
    Math.min(track - 8, Math.max(minimumThumb, Math.round((track * viewport) / content))),
  );
  return { range, thumb, travel: track - thumb };
}
