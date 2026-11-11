import { useEffect } from "react";
import { consumePendingInitialPrompt } from "@/store/chatStore";
import { useConversationChatStore } from "./ScopedChatStore";

/** Claim a first prompt only after this conversation can send it, never while hydrating. */
export function useScopedInitialPrompt(conversationId: string, agentId: string | null): void {
  const useChatStore = useConversationChatStore();
  const loading = useChatStore((state) => state.loadingConversation);
  const error = useChatStore((state) => state.conversationLoadError);
  useEffect(() => {
    if (loading || error || !agentId) return;
    const prompt = consumePendingInitialPrompt(conversationId);
    if (!prompt) return;
    const store = useChatStore.getState();
    if (prompt.skill) {
      void store.sendSlashCommand(prompt.skill.name, prompt.skill.args, agentId, {
        pinnedConversationId: conversationId,
      });
    } else {
      void store.send(prompt.text, agentId, prompt.files ?? [], {
        pinnedConversationId: conversationId,
      });
    }
  }, [agentId, conversationId, error, loading, useChatStore]);
}
