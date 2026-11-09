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
  scopes.set(key, Object.freeze({ path: scope.path, directories }));
  if (scopes.size > MAX_SCOPES) scopes.delete(scopes.keys().next().value!);
  for (const listener of listeners) listener();
}

export function subscribeExplorerGitScopes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
