import { useInfiniteQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/identity";
import { SEARCH_FETCH_TIMEOUT_MS } from "./useConversations";
import type { MessageSearchPage } from "@/shell/contextSearch/types";

export class MessageSearchError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(
      status === 404 || status === 501
        ? "Message search is unavailable on this server."
        : "Couldn't search messages.",
    );
    this.status = status;
  }
}

export async function fetchMessageSearch({
  query,
  sessionId,
  cursor,
  signal,
}: {
  query: string;
  sessionId?: string;
  cursor?: string;
  signal: AbortSignal;
}): Promise<MessageSearchPage> {
  const params = new URLSearchParams({ query, limit: "40" });
  if (sessionId) {
    params.set("session_id", sessionId);
    params.set("include_archived", "true");
  }
  if (cursor) params.set("cursor", cursor);
  const response = await authenticatedFetch(`/v1/sessions/search/messages?${params}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_FETCH_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new MessageSearchError(response.status);
  return response.json() as Promise<MessageSearchPage>;
}

export function useMessageSearch(
  query: string,
  sessionId: string | undefined,
  enabled: boolean,
  identity: string,
) {
  return useInfiniteQuery({
    queryKey: ["message-search", identity, query, sessionId ?? null],
    queryFn: ({ pageParam, signal }) =>
      fetchMessageSearch({ query, sessionId, cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    enabled: enabled && query.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 0,
  });
}
