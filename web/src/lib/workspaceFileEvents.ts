export interface WorkspaceFilesChanged {
  conversationId: string;
  moves: { source: string; destination: string }[];
  removed: string[];
}

function containsPath(parent: string, path: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

/** Resolve an open file after a filesystem operation, including moved folders. */
export function reconcileWorkspaceFilePath(
  path: string,
  changes: Pick<WorkspaceFilesChanged, "moves" | "removed">,
): string | null {
  if (changes.removed.some((removed) => containsPath(removed, path))) return null;
  const move = changes.moves
    .filter(({ source }) => containsPath(source, path))
    .sort((left, right) => right.source.length - left.source.length)[0];
  return move ? move.destination + path.slice(move.source.length) : path;
}
