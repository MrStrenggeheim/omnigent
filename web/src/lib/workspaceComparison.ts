import { useCallback, useSyncExternalStore } from "react";

export interface WorkspaceComparison {
  source: "git" | "since" | "range" | "commit" | "agent" | "last-turn";
  base: string;
  target: string;
  /** A captured turn id, or current; omitted selects the latest completed turn. */
  turnId?: string;
  /** Chat whose captured history is being compared; never inferred from workspace transport. */
  sourceChatId?: string;
}

export interface ComparisonTurn {
  id: string;
  label: string;
  finished: boolean;
}

export const DEFAULT_WORKSPACE_COMPARISON: WorkspaceComparison = Object.freeze({
  source: "git",
  base: "HEAD",
  target: "WORKTREE",
});
export type WorkspaceComparisonView = "files" | "changes";
export interface WorkspaceComparisonScope {
  workspaceId?: string;
  conversationId?: string;
  view?: WorkspaceComparisonView;
}
export type WorkspaceComparisonIdentity = string | WorkspaceComparisonScope | undefined;

/** Strings retain the legacy Changes selection for session-bound callers. */
export function workspaceComparisonKey(identity: WorkspaceComparisonIdentity): string | undefined {
  const scope = typeof identity === "string" ? { conversationId: identity } : identity;
  const owner = scope?.workspaceId || scope?.conversationId;
  return owner
    ? JSON.stringify([scope?.workspaceId ? "workspace" : "chat", owner, scope?.view ?? "changes"])
    : undefined;
}

const STORAGE_KEY = "omnigent:workspace-comparisons:v1";
const MAX_SELECTIONS = 100;
function readSelections(): Map<string, WorkspaceComparison> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return new Map();
    return new Map(
      stored
        .filter((entry): entry is [string, WorkspaceComparison] => {
          if (!Array.isArray(entry) || typeof entry[0] !== "string") return false;
          const value = entry[1];
          return (
            value &&
            ["git", "since", "range", "commit", "agent", "last-turn"].includes(value.source) &&
            typeof value.base === "string" &&
            typeof value.target === "string" &&
            (value.turnId === undefined || typeof value.turnId === "string") &&
            (value.sourceChatId === undefined || typeof value.sourceChatId === "string") &&
            (!isAgentComparison(value) || !!value.sourceChatId)
          );
        })
        .slice(-MAX_SELECTIONS)
        .map(([key, value]) => [key, Object.freeze({ ...value })]),
    );
  } catch {
    // Invalid or inaccessible browser storage leaves the default usable.
    return new Map();
  }
}
const selections = readSelections();
function persistSelections() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selections]));
  } catch {
    // Keep in-memory selections when browser storage is unavailable or full.
  }
}
const listeners = new Set<() => void>();

export function getWorkspaceComparison(
  identity?: WorkspaceComparisonIdentity,
): WorkspaceComparison {
  const key = workspaceComparisonKey(identity);
  return (key && selections.get(key)) || DEFAULT_WORKSPACE_COMPARISON;
}

export function setWorkspaceComparison(
  identity: WorkspaceComparisonIdentity,
  value: WorkspaceComparison,
) {
  const key = workspaceComparisonKey(identity);
  if (!key) return;
  const sourceChatId = typeof identity === "string" ? identity : identity?.conversationId;
  const next = isAgentComparison(value)
    ? { ...value, sourceChatId: value.sourceChatId || sourceChatId }
    : value;
  if (isAgentComparison(next) && !next.sourceChatId) return;
  const previous = getWorkspaceComparison(identity);
  if (
    previous.source === next.source &&
    previous.base === next.base &&
    previous.target === next.target &&
    previous.turnId === next.turnId &&
    previous.sourceChatId === next.sourceChatId
  )
    return;
  selections.delete(key);
  selections.set(key, Object.freeze({ ...next }));
  if (selections.size > MAX_SELECTIONS) selections.delete(selections.keys().next().value!);
  persistSelections();
  for (const listener of listeners) listener();
}

export function subscribeWorkspaceComparisons(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkspaceComparison(identity?: WorkspaceComparisonIdentity) {
  const workspaceId = typeof identity === "object" ? identity.workspaceId : undefined;
  const conversationId = typeof identity === "string" ? identity : identity?.conversationId;
  const view = typeof identity === "object" ? identity.view : undefined;
  const comparison = useSyncExternalStore(
    subscribeWorkspaceComparisons,
    () => getWorkspaceComparison(identity),
    () => DEFAULT_WORKSPACE_COMPARISON,
  );
  const setComparison = useCallback(
    (value: WorkspaceComparison) => {
      if (isAgentComparison(value) && !conversationId) return;
      setWorkspaceComparison(
        { workspaceId, conversationId, view },
        isAgentComparison(value) ? { ...value, sourceChatId: conversationId } : value,
      );
    },
    [workspaceId, conversationId, view],
  );
  return { comparison, setComparison };
}

export function isAgentComparison(value: WorkspaceComparison) {
  return value.source === "agent" || value.source === "last-turn";
}

export function isRevisionComparison(value: WorkspaceComparison) {
  return value.source === "since" || value.source === "range" || value.source === "commit";
}

const FILE_SCOPES_STORAGE_KEY = "omnigent:file-comparison-scopes:v1";
function readFileScopes(): Map<string, WorkspaceComparisonView> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FILE_SCOPES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return new Map();
    return new Map(
      stored
        .filter(
          (entry): entry is [string, WorkspaceComparisonView] =>
            Array.isArray(entry) &&
            typeof entry[0] === "string" &&
            (entry[1] === "files" || entry[1] === "changes"),
        )
        .slice(-MAX_SELECTIONS),
    );
  } catch {
    // Invalid or inaccessible browser storage leaves file origins unset.
    return new Map();
  }
}
const fileScopes = readFileScopes();
function fileScopeKey(identity: WorkspaceComparisonIdentity, path: string) {
  const owner = workspaceComparisonKey(
    typeof identity === "object" ? { ...identity, view: "changes" } : identity,
  );
  return owner && path ? JSON.stringify([owner, path]) : undefined;
}

/** Read a file tab's opening surface, independently of the current rail tab. */
export function getFileComparisonScope(
  identity: WorkspaceComparisonIdentity,
  path: string,
): WorkspaceComparisonView | undefined {
  const key = fileScopeKey(identity, path);
  return key ? fileScopes.get(key) : undefined;
}

/** Call inside the parent's accepted navigation, after its dirty-file guard. */
export function setFileComparisonScope(
  identity: WorkspaceComparisonIdentity,
  path: string,
  view: WorkspaceComparisonView,
): void {
  const key = fileScopeKey(identity, path);
  if (!key || fileScopes.get(key) === view) return;
  fileScopes.delete(key);
  fileScopes.set(key, view);
  if (fileScopes.size > MAX_SELECTIONS) fileScopes.delete(fileScopes.keys().next().value!);
  try {
    localStorage.setItem(FILE_SCOPES_STORAGE_KEY, JSON.stringify([...fileScopes]));
  } catch {
    // Keep file-tab provenance in memory when browser storage is unavailable.
  }
  for (const listener of listeners) listener();
}
