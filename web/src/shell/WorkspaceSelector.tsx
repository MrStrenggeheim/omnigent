import type { ButtonHTMLAttributes } from "react";
import { ChevronDownIcon, FolderIcon, MonitorIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WorkspaceSelectorProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  hostLabel: string;
  path: string;
}

/** Shared borderless host and directory trigger. */
export function WorkspaceSelector({
  hostLabel,
  path,
  className,
  ...props
}: WorkspaceSelectorProps) {
  return (
    <button
      type="button"
      aria-label={`Select workspace: ${hostLabel} / ${path || "Choose path"}`}
      className={cn(
        "inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:min-h-7",
        className,
      )}
      {...props}
    >
      <MonitorIcon className="size-3.5 shrink-0" aria-hidden />
      <span
        data-workspace-collapse-label=""
        className="workspace-selector-details inline-flex min-w-0 items-center gap-1.5 group-data-[labels=collapsed]/composer-actions:hidden group-data-[labels=collapsed]/composer-workspace:hidden"
      >
        <span className="max-w-32 truncate">{hostLabel}</span>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <FolderIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{path || "Choose path"}</span>
      </span>
      <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
    </button>
  );
}
