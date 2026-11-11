import { useLayoutEffect, useState } from "react";
import { ChatPage } from "@/pages/ChatPage";
import { migrateConversationDraft } from "./conversationDraft";
import { ScopedConversationTerminal } from "./ScopedConversationTerminal";

/** Restore shared drafts before the existing full composer mounts. */
export function ScopedConversationSurface({
  conversationId,
  visible,
}: {
  conversationId: string;
  visible: boolean;
}) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    migrateConversationDraft(conversationId);
    setReady(true);
  }, [conversationId]);
  if (!ready) return null;
  return (
    <ScopedConversationTerminal key={conversationId} conversationId={conversationId}>
      <ChatPage conversationId={conversationId} visible={visible} />
    </ScopedConversationTerminal>
  );
}
