import { type ReactNode, createContext, useContext, useMemo } from "react";
import { useSendCommentsToAgent } from "@/hooks/useComments";

interface CommentSender {
  /** Fire the POST /comments/send mutation. */
  mutate: ReturnType<typeof useSendCommentsToAgent>["mutate"];
  /** True while a `mutate` call is in flight. */
  isPending: boolean;
}

const CommentSenderContext = createContext<CommentSender | null>(null);

/** Keep descendants mounted while the active session's agent binding resolves. */
export function CommentSenderProvider({
  sessionId,
  agentId,
  children,
}: {
  sessionId: string;
  agentId: string | null;
  children: ReactNode;
}) {
  const mutation = useSendCommentsToAgent(sessionId, agentId);
  const value = useMemo(
    () => (agentId === null ? null : { mutate: mutation.mutate, isPending: mutation.isPending }),
    [agentId, mutation.mutate, mutation.isPending],
  );
  return <CommentSenderContext.Provider value={value}>{children}</CommentSenderContext.Provider>;
}

/**
 * Read the ambient `CommentSender` from context.
 *
 * Returns `null` when not wrapped in a provider, or when the provider
 * was given a null `agentId`. Callers MUST null-check before invoking
 * `mutate` — and should hide any "Send to agent" UI in that case.
 */
export function useOptionalCommentSender(): CommentSender | null {
  return useContext(CommentSenderContext);
}
