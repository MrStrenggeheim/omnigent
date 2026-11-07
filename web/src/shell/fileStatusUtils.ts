import type { WorkspaceChangedFile } from "@/hooks/useWorkspaceChangedFiles";

/** Fixed-width diffstat column so change counts do not shift adjacent controls. */
export const ROW_META_SLOT_CLASS = "w-14";

/**
 * Width of the git-status marker column at the end of a tree row's name button
 * — the A/M/D badge on files, the dirty dot on directories.
 *
 * Both markers are centred in this same box so they share one column. Sizing
 * each to its own content instead left them ~4px apart: the dot already had a
 * 22px box while the letter was a variable-width badge centred on itself, so
 * the two markers never quite lined up down the tree.
 */
export const ROW_STATUS_SLOT_CLASS = "w-[22px]";

export function gitStatusLetter(status: WorkspaceChangedFile["status"]): string {
  switch (status) {
    case "created":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

export function gitStatusLabel(status: WorkspaceChangedFile["status"]): string {
  switch (status) {
    case "created":
      return "Added";
    case "deleted":
      return "Deleted";
    case "modified":
      return "Modified";
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  for (let i = 0; i < units.length; i += 1) {
    if (value < 1024 || i === units.length - 1) {
      return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}
