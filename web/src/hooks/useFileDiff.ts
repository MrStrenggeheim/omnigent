// TanStack Query hook for the filesystem file-diff endpoint:
// `GET /v1/sessions/{sessionId}/resources/environments/{environmentId}/diff/{path}`.
//
// Returns `before` (content at first observed modification) and `after`
// (current content) as strings — either may be null:
//   before=null → new file (no pre-session snapshot available)
//   after=null  → deleted file
//
// Requested diffs can start while the changed-files list is loading. Known
// unchanged files and unavailable workspaces keep the query disabled.

import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/identity";
import { isTempConvId } from "@/lib/tempConversationId";
import {
  useWorkbenchWorkspace,
  queryIdentity,
  resourceBase,
  type WorkspaceResourceTarget,
} from "@/lib/workbenchWorkspace";
import {
  useWorkspaceChangedFiles,
  useWorkspaceEnvironment,
  useWorkspaceServeable,
} from "@/hooks/useWorkspaceChangedFiles";

// The primary workspace environment is always "default".
const DEFAULT_ENVIRONMENT_ID = "default";

export interface FileDiffResponse {
  object: "session.environment.filesystem.file_diff";
  path: string;
  /** File content at the time of the first modification, or null for new files. */
  before: string | null;
  /** Current file content, or null for deleted files. */
  after: string | null;
}

class FileDiffError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetchFileDiff(
  conversationId: string,
  path: string,
  workspace?: WorkspaceResourceTarget,
): Promise<FileDiffResponse> {
  // Encode each path segment individually so slashes remain structural.
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url =
    `${resourceBase(workspace, conversationId)}` +
    `/environments/${DEFAULT_ENVIRONMENT_ID}/diff/${encodedPath}`;
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    // Surface the server's reason (e.g. "git status timed out after 5.0s")
    // so the diff view shows what actually went wrong rather than a bare
    // status code — mirroring the changed-files panel.
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Non-JSON body (gateway/front-door error) — keep the status line.
    }
    throw new FileDiffError(message, res.status);
  }
  return (await res.json()) as FileDiffResponse;
}

/**
 * Fetch before/after diff content for a changed workspace file.
 *
 * Disabled (no request made) when:
 * - `conversationId` or `path` is missing, or the session id is temporary
 * - neither the runner nor host can serve the workspace
 * - the file is known unchanged (or discovery is pending without a request)
 */
export function useFileDiff(
  conversationId: string | undefined,
  path: string | null,
  options: { requested?: boolean } = {},
) {
  const workspace = useWorkbenchWorkspace();
  const identity = queryIdentity(workspace, conversationId);
  const serveable = useWorkspaceServeable(conversationId);
  const changedFiles = useWorkspaceChangedFiles(conversationId);
  const environment = useWorkspaceEnvironment(conversationId);
  const isInChangedFiles = changedFiles.data?.data.some((f) => f.path === path) ?? false;

  const requestedBeforeDiscovery =
    options.requested && changedFiles.data === undefined && !changedFiles.isError;

  return useQuery({
    queryKey: ["file-diff", identity, path],
    queryFn: () => fetchFileDiff(conversationId!, path!, workspace),
    enabled:
      !!identity &&
      (!!workspace || !isTempConvId(conversationId)) &&
      !!path &&
      serveable !== false &&
      environment.data?.available !== false &&
      (isInChangedFiles || !!requestedBeforeDiscovery),
    // An old diff link may point to a now-unchanged file; don't retry its expected 404.
    ...(requestedBeforeDiscovery && {
      retry: (failureCount: number, error: Error) =>
        !(error instanceof FileDiffError && error.status === 404) && failureCount < 3,
    }),
    staleTime: 5_000,
  });
}

export function useGitFileDiff(
  conversationId: string | undefined,
  path: string | null,
  options: { enabled: boolean; base: string; target: string; scope?: string },
) {
  const workspace = useWorkbenchWorkspace();
  const identity = queryIdentity(workspace, conversationId);
  const serveable = useWorkspaceServeable(conversationId);
  return useQuery<FileDiffResponse & { repository?: string; base?: string; target?: string }>({
    queryKey: ["git-file-diff", identity, path, options.base, options.target, options.scope],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        operation: "diff",
        path: path!,
        base: options.base,
        target: options.target,
        ...(options.scope !== undefined ? { scope: options.scope } : {}),
      });
      const response = await authenticatedFetch(
        `${resourceBase(workspace, conversationId)}/environments/default/git?${params}`,
        { signal },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? payload.detail ?? "Git comparison is unavailable",
        );
      }
      return payload;
    },
    enabled:
      options.enabled &&
      !!identity &&
      (!!workspace || !isTempConvId(conversationId)) &&
      !!path &&
      serveable !== false,
    staleTime: 5_000,
    refetchInterval: options.target === "WORKTREE" ? 5_000 : false,
    retry: false,
  });
}

export function useAgentFileDiff(
  conversationId: string | undefined,
  path: string | null,
  options: { enabled: boolean; lastTurn: boolean; turnId?: string },
) {
  return useQuery<
    FileDiffResponse & { patch?: string; coverage?: string; turn_id?: string; warning?: string }
  >({
    queryKey: ["agent-file-diff", conversationId, path, options.lastTurn, options.turnId],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        path: path!,
        baseline: options.lastTurn ? "last_turn" : "session",
        ...(options.turnId ? { turn_id: options.turnId } : {}),
      });
      const response = await authenticatedFetch(
        `/v1/sessions/${encodeURIComponent(conversationId!)}/resources/environments/default/agent-diff?${params}`,
        { signal },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message ?? payload.detail ?? "Agent baseline is unavailable",
        );
      return payload;
    },
    enabled: options.enabled && !!conversationId && !isTempConvId(conversationId) && !!path,
    refetchInterval: 5_000,
    retry: false,
    staleTime: 5_000,
  });
}
