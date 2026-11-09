import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch, getCurrentUserId, subscribeIdentity } from "@/lib/identity";
import { ApiError, apiErrorFromResponse } from "@/lib/sessionsApi";
import type { WorkbenchWorkspace } from "@/lib/workbenchTypes";

async function workspaceResponse(response: Response): Promise<WorkbenchWorkspace> {
  const value = await response.json();
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.root !== "string" ||
    !Array.isArray(value.capabilities)
  ) {
    throw new Error("The server returned an invalid workspace identity.");
  }
  return value as WorkbenchWorkspace;
}

export async function resolveChatWorkspace(sessionId: string): Promise<WorkbenchWorkspace> {
  const response = await authenticatedFetch("/v1/workbench-workspaces/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!response.ok) throw await apiErrorFromResponse(response);
  return workspaceResponse(response);
}

/** The active chat is the sole source of the panel's workspace identity. */
export function useWorkbenchSelection(
  sessionId: string | undefined,
  enabled = true,
  beforeChange?: (
    workspace: WorkbenchWorkspace | null,
    apply: () => void,
    previousSession?: string,
  ) => void,
) {
  const user = useSyncExternalStore(subscribeIdentity, getCurrentUserId, () => null);
  const chatWorkspace = useQuery({
    queryKey: ["chat-workbench-workspace", user, sessionId],
    queryFn: () => resolveChatWorkspace(sessionId!),
    enabled: enabled && !!sessionId,
    retry: false,
    staleTime: 0,
  });
  const [accepted, setAccepted] = useState<{
    user: string | null;
    sessionId?: string;
    workspace: WorkbenchWorkspace | undefined;
    error: Error | null;
  }>();
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  const transition = useRef(0);
  const guard = useRef(beforeChange);
  guard.current = beforeChange;
  useEffect(() => {
    const token = ++transition.current;
    const failure = chatWorkspace.error;
    const target = failure ? undefined : chatWorkspace.data;
    if (!sessionId || (!target && !failure)) return;
    // Shared chats and older servers retain their existing session-authorized APIs.
    const compatibility =
      failure instanceof ApiError && [403, 404, 405, 501].includes(failure.status);
    const error = compatibility ? null : failure;
    const apply = () => {
      if (transition.current === token) {
        const next = { user, sessionId, workspace: target, error };
        acceptedRef.current = next;
        setAccepted(next);
      }
    };
    const previous = acceptedRef.current;
    const previousIdentity = previous?.workspace?.id ?? previous?.sessionId;
    const nextIdentity = target?.id ?? sessionId;
    if (previous?.user === user && previousIdentity !== nextIdentity && guard.current)
      guard.current(target ?? null, apply, previous.sessionId);
    else apply();
    return () => {
      transition.current += 1;
    };
  }, [sessionId, user, chatWorkspace.data, chatWorkspace.error]);
  const workspace = sessionId && accepted?.user === user ? accepted.workspace : undefined;
  return {
    workspace,
    sourceSessionId: accepted?.sessionId,
    chatWorkspace: sessionId ? chatWorkspace.data : undefined,
    selectedId: workspace?.id ?? null,
    error: accepted?.user === user && accepted.sessionId === sessionId ? accepted.error : null,
    isLoading: !!sessionId && chatWorkspace.isLoading,
  };
}
