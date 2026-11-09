import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authenticatedFetch, getCurrentUserId, subscribeIdentity } from "@/lib/identity";
import { apiErrorFromResponse } from "@/lib/sessionsApi";
import type { WorkbenchWorkspace } from "@/lib/workbenchTypes";

const selectionKey = (user: string | null) => `omnigent:workbench-selection:${user ?? "local"}`;
function readSelection(user: string | null): string | null {
  try {
    return localStorage.getItem(selectionKey(user));
  } catch {
    return null;
  }
}

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

/** Selecting a chat never changes an already selected filesystem workspace. */
export function useWorkbenchSelection(
  sessionId: string | undefined,
  enabled = true,
  requestedWorkspaceId?: string | null,
) {
  const user = useSyncExternalStore(subscribeIdentity, getCurrentUserId, () => null);
  const [selection, setSelection] = useState(() => ({ user, id: readSelection(user) }));
  const id = requestedWorkspaceId || (selection.user === user ? selection.id : readSelection(user));
  const queryClient = useQueryClient();
  const select = useCallback(
    (workspace: WorkbenchWorkspace) => {
      queryClient.setQueryData(["workbench-workspace", user, workspace.id], workspace);
      setSelection({ user, id: workspace.id });
      try {
        localStorage.setItem(selectionKey(user), workspace.id);
      } catch {
        /* Browsing remains usable when persistence is disabled. */
      }
    },
    [queryClient, user],
  );
  const chatWorkspace = useQuery({
    queryKey: ["chat-workbench-workspace", user, sessionId],
    queryFn: () => resolveChatWorkspace(sessionId!),
    enabled: enabled && !!sessionId,
    retry: false,
    staleTime: 30_000,
  });
  const selected = useQuery<WorkbenchWorkspace>({
    queryKey: ["workbench-workspace", user, id],
    queryFn: async () => {
      const response = await authenticatedFetch(
        `/v1/workbench-workspaces/${encodeURIComponent(id!)}`,
      );
      if (!response.ok) throw await apiErrorFromResponse(response);
      return workspaceResponse(response);
    },
    enabled: !!id,
    retry: false,
    staleTime: 30_000,
  });
  const known = useQuery<{ data: WorkbenchWorkspace[] }>({
    queryKey: ["workbench-workspaces", user],
    queryFn: async () => {
      const response = await authenticatedFetch("/v1/workbench-workspaces");
      if (!response.ok) throw await apiErrorFromResponse(response);
      return response.json();
    },
    enabled: !!id || selected.data !== undefined,
    staleTime: 30_000,
    retry: false,
  });
  useEffect(() => {
    if (!id && chatWorkspace.data) select(chatWorkspace.data);
  }, [id, chatWorkspace.data, select]);
  const create = useMutation({
    mutationFn: async ({ hostId, root }: { hostId: string; root: string }) => {
      const response = await authenticatedFetch("/v1/workbench-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: hostId, root }),
      });
      if (!response.ok) throw await apiErrorFromResponse(response);
      return workspaceResponse(response);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["workbench-workspaces", user] }),
  });
  return {
    workspace: selected.data ?? (!id ? chatWorkspace.data : undefined),
    selectedId: id,
    chatWorkspace: chatWorkspace.data,
    workspaces: known.data?.data ?? [],
    select,
    create,
    error: selected.error,
    isLoading: selected.isLoading || (!id && chatWorkspace.isLoading),
    mismatch: !!selected.data && !!chatWorkspace.data && selected.data.id !== chatWorkspace.data.id,
  };
}
