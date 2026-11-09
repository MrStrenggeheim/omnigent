// TanStack Query hooks for the comments API:
// POST/GET/PATCH/DELETE /v1/sessions/{id}/comments
// POST /v1/sessions/{id}/comments/send
//
// `useSendCommentsToAgent` calls `useChatStore.send()` directly on success
// so the message is submitted immediately without requiring a manual send.
// A missing agent rejects the mutation before any request is sent.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/identity";
import { useChatStore } from "@/store/chatStore";

export interface Comment {
  id: string;
  conversation_id: string;
  path: string;
  /** 0-based absolute character offset (inclusive) within the file. */
  start_index: number;
  /** 0-based absolute character offset (exclusive) within the file. */
  end_index: number;
  body: string;
  status: "draft" | "addressed";
  created_at: number;
  /**
   * Unix **microseconds** of the last body/status mutation (set at creation
   * when never edited). Used for change detection, not display; divide by
   * 1000 before passing to `new Date()` if it's ever rendered.
   */
  updated_at: number;
  anchor_content: string | null;
  created_by: string | null;
}

// ── Query helpers ────────────────────────────────────────────────────────────

// Exported for `useCommentInbox`, which mounts the same queries for
// every session with comments — sharing this key keeps its cache and
// the SessionUpdatesProvider fingerprint invalidation in sync.
export function commentsQueryKey(sessionId: string, path?: string) {
  return path ? ["comments", sessionId, path] : ["comments", sessionId];
}

export async function fetchComments(sessionId: string, path?: string): Promise<Comment[]> {
  const url = path
    ? `/v1/sessions/${encodeURIComponent(sessionId)}/comments?path=${encodeURIComponent(path)}`
    : `/v1/sessions/${encodeURIComponent(sessionId)}/comments`;
  const res = await authenticatedFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as Comment[];
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetch comments for a session, optionally filtered to a single file.
 *
 * Disabled when `sessionId` is falsy.
 */
export function useComments(sessionId: string | undefined, path?: string) {
  return useQuery({
    queryKey: commentsQueryKey(sessionId ?? "", path),
    queryFn: () => fetchComments(sessionId!, path),
    enabled: !!sessionId,
    staleTime: 2_000,
  });
}

/** POST /v1/sessions/{id}/comments */
export function useAddComment(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      path: string;
      start_index: number;
      end_index: number;
      body: string;
      anchor_content?: string | null;
    }) => {
      const res = await authenticatedFetch(
        `/v1/sessions/${encodeURIComponent(sessionId)}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as Comment;
    },
    onSuccess: (comment) => {
      // Invalidate both the full-session list and the per-file list
      // so the sidebar and any per-file views refresh.
      void queryClient.invalidateQueries({
        queryKey: ["comments", sessionId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["comments", sessionId, comment.path],
      });
    },
  });
}

/** DELETE /v1/sessions/{id}/comments/{commentId} */
export function useDeleteComment(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const res = await authenticatedFetch(
        `/v1/sessions/${encodeURIComponent(sessionId)}/comments/${encodeURIComponent(commentId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["comments", sessionId],
      });
    },
  });
}

/** PATCH /v1/sessions/{id}/comments/{commentId} */
export function useUpdateComment(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { commentId: string; status?: string; body?: string }) => {
      const { commentId, ...fields } = payload;
      const res = await authenticatedFetch(
        `/v1/sessions/${encodeURIComponent(sessionId)}/comments/${encodeURIComponent(commentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as Comment;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["comments", sessionId],
      });
    },
  });
}

/** Send comments to the session and agent captured when the mutation starts. */
export function useSendCommentsToAgent(sessionId: string, agentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["comments-send", sessionId, agentId],
    mutationFn: async (payload: { comment_ids: string[]; instruction?: string }) => {
      if (agentId === null) throw new Error("No agent is available to receive comments");
      const recipient = { sessionId, agentId };
      const res = await authenticatedFetch(
        `/v1/sessions/${encodeURIComponent(sessionId)}/comments/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as {
        formatted_message: string;
        sent_comment_ids: string[];
      };
      return { ...data, recipient };
    },
    onSuccess: ({ formatted_message, recipient }) => {
      void useChatStore.getState().send(formatted_message, recipient.agentId, undefined, {
        pinnedConversationId: recipient.sessionId,
      });
      void queryClient.invalidateQueries({
        queryKey: ["comments", recipient.sessionId],
      });
    },
  });
}
