import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch, getCurrentUserId, subscribeIdentity } from "@/lib/identity";
import { apiErrorFromResponse } from "@/lib/sessionsApi";
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
    workspace: WorkbenchWorkspace,
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
    workspace: WorkbenchWorkspace;
  }>();
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  const transition = useRef(0);
  const guard = useRef(beforeChange);
  guard.current = beforeChange;
  useEffect(() => {
    const token = ++transition.current;
    const target = chatWorkspace.data;
    if (!sessionId || !target) return;
    const apply = () => {
      if (transition.current === token) {
        const next = { user, sessionId, workspace: target };
        acceptedRef.current = next;
        setAccepted(next);
      }
    };
    const previous = acceptedRef.current;
    if (previous?.user === user && previous.workspace.id !== target.id && guard.current)
      guard.current(target, apply, previous.sessionId);
    else apply();
    return () => {
      transition.current += 1;
    };
  }, [sessionId, user, chatWorkspace.data]);
  const workspace =
    sessionId && accepted?.user === user && !chatWorkspace.error ? accepted.workspace : undefined;
  return {
    workspace,
    sourceSessionId: accepted?.sessionId,
    chatWorkspace: sessionId ? chatWorkspace.data : undefined,
    selectedId: workspace?.id ?? null,
    error: chatWorkspace.error,
    isLoading: !!sessionId && chatWorkspace.isLoading,
  };
}
