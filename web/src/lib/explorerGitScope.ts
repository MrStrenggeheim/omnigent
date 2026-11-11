import { readResourceViewState, writeResourceViewState } from "./resourceViewStorage";
import { workspaceComparisonKey, type WorkspaceComparisonIdentity } from "./workspaceComparison";

export interface ExplorerGitScope {
  path: string;
  directories: string[];
}

const DEFAULT_SCOPE: ExplorerGitScope = { path: "", directories: [] };
Object.freeze(DEFAULT_SCOPE.directories);
Object.freeze(DEFAULT_SCOPE);
const scopes = new Map<string, ExplorerGitScope>();
const listeners = new Set<() => void>();
const MAX_SCOPES = 100;

export function getExplorerGitScope(identity: WorkspaceComparisonIdentity): ExplorerGitScope {
  const key = workspaceComparisonKey(
    typeof identity === "object" ? { ...identity, view: "changes" } : identity,
  );
  if (key && typeof identity === "object" && identity.viewId) {
    const saved = readResourceViewState<ExplorerGitScope>(`git-scope:${key}`);
    return saved &&
      typeof saved.path === "string" &&
      Array.isArray(saved.directories) &&
      saved.directories.every((path) => typeof path === "string")
      ? saved
      : DEFAULT_SCOPE;
  }
  return (key && scopes.get(key)) || DEFAULT_SCOPE;
}

export function setExplorerGitScope(
  identity: WorkspaceComparisonIdentity,
  scope: ExplorerGitScope,
): void {
  const key = workspaceComparisonKey(
    typeof identity === "object" ? { ...identity, view: "changes" } : identity,
  );
  if (!key) return;
  const directories = [...new Set(scope.directories)].sort();
  const previous = getExplorerGitScope(identity);
  if (
    previous.path === scope.path &&
    previous.directories.length === directories.length &&
    previous.directories.every((path, index) => path === directories[index])
  )
    return;
  scopes.delete(key);
  Object.freeze(directories);
  const next = Object.freeze({ path: scope.path, directories });
  scopes.set(key, next);
  if (typeof identity === "object" && identity.viewId)
    writeResourceViewState(`git-scope:${key}`, next);
  if (scopes.size > MAX_SCOPES) scopes.delete(scopes.keys().next().value!);
  for (const listener of listeners) listener();
}

export function subscribeExplorerGitScopes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
