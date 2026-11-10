import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";
import { cn } from "@/lib/utils";
import { ROW_STATUS_SLOT_CLASS, gitStatusColor, gitStatusLetter } from "./fileStatusUtils";

export function FileStatusMarker({
  status,
  inherited = false,
}: {
  status: WorkspaceChangedFile["status"] | undefined;
  inherited?: boolean;
}) {
  if (!status) return null;
  return (
    <span
      data-file-status={inherited ? "descendant" : status}
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center",
        ROW_STATUS_SLOT_CLASS,
        gitStatusColor(status),
      )}
    >
      <span
        className={
          inherited ? "text-[8px] leading-none" : "rounded px-1 py-0.5 font-mono text-[10px]"
        }
      >
        {inherited ? "●" : gitStatusLetter(status)}
      </span>
    </span>
  );
}
