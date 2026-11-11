import { MessageSquareIcon } from "lucide-react";
import type { MessageCommunication } from "@/lib/messageCommunication";
import type { MessageContentBlock } from "@/lib/blocks";
import { Link } from "@/lib/routing";
import { ActivityRow } from "@/components/ActivityRow";
import { useWorkbench } from "@/workbench/WorkbenchContext";
import { useScopedConversationId } from "@/components/chat/conversationScope";
import { useContext } from "react";
import { QueryClientContext, useQuery } from "@tanstack/react-query";
import { getSessionSlim } from "@/lib/sessionsApi";
import { getOmnigentServerIdentity } from "@/lib/host";
import { useViewerId } from "@/hooks/useViewerId";

function AuthorizedConversationName({ id, fallback }: { id: string; fallback: string }) {
  const viewer = useViewerId();
  const query = useQuery({
    queryKey: ["peer-source-label", getOmnigentServerIdentity(), viewer, id],
    queryFn: () => getSessionSlim(id, { refreshState: false }),
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false,
  });
  return !query.isFetching && !query.isError ? query.data?.title || fallback : fallback;
}

export function PeerMessage({
  communication,
  content,
  itemId,
}: {
  communication: MessageCommunication;
  content: MessageContentBlock[];
  itemId: string;
}) {
  const workbench = useWorkbench();
  const conversationId = useScopedConversationId();
  const outgoing = conversationId === communication.source_conversation_id;
  const queryClient = useContext(QueryClientContext);
  const text = content
    .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
  const source = communication.source_title || communication.source_agent_id || "Agent";
  const id = outgoing
    ? communication.destination_conversation_id
    : communication.source_conversation_id;
  const fallback = outgoing ? "conversation" : source;
  const label = (
    <>
      {outgoing ? "Message to " : "From "}
      {id && queryClient ? (
        <AuthorizedConversationName
          id={id}
          fallback={outgoing ? "conversation" : communication.source_agent_id || "Agent"}
        />
      ) : (
        fallback
      )}
    </>
  );
  const title = id ? (
    <Link
      to={`/c/${encodeURIComponent(id)}`}
      onClick={(event) => {
        if (workbench && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          workbench.openConversation(id, { beside: true });
        }
      }}
    >
      {label}
    </Link>
  ) : (
    label
  );
  return (
    <div
      data-testid="peer-message"
      data-message-id={itemId}
      data-communication-id={communication.message_id}
    >
      <ActivityRow
        icon={<MessageSquareIcon className="size-3.5" />}
        title={title}
        status={
          communication.delivery_state === "unknown" ? "Unconfirmed" : communication.delivery_state
        }
        preview={text}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Delivery</dt>
          <dd>{communication.delivery_state}</dd>
          {communication.receipt && (
            <>
              <dt>Receipt</dt>
              <dd>{communication.receipt.replaceAll("_", " ")}</dd>
            </>
          )}
          {communication.sent_at && (
            <>
              <dt>Sent</dt>
              <dd>{new Date(communication.sent_at * 1000).toLocaleString()}</dd>
            </>
          )}
        </dl>
      </ActivityRow>
    </div>
  );
}
