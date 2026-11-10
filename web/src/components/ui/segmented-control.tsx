import type { ComponentProps, ReactNode } from "react";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger, type TooltipShortcut } from "./tooltip";
import { cn } from "@/lib/utils";

/** Shared track and pressed states for compact, single-choice controls. */
export function SegmentedControl({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="segmented-control"
      className={cn(
        "flex h-6 w-fit shrink-0 items-center gap-0.5 rounded-[6px] bg-muted p-0",
        className,
      )}
      {...props}
    />
  );
}

export function SegmentedControlItem({
  label,
  active,
  iconOnly = false,
  shortcut,
  tooltipSide = "bottom",
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  label: string;
  active: boolean;
  iconOnly?: boolean;
  shortcut?: TooltipShortcut;
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"];
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant={active ? "secondary" : "ghost"}
            size={iconOnly ? "icon-xs" : "xs"}
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "h-6 rounded-[6px] border px-2.5 py-0",
              iconOnly && "w-9",
              active
                ? "border-border bg-background text-foreground shadow-sm hover:bg-background"
                : "border-transparent text-muted-foreground hover:bg-transparent hover:text-foreground",
              className,
            )}
            {...props}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} shortcut={shortcut}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
