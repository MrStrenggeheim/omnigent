import { useScopedConversationId } from "./conversationScope";
import { QuoteDestinationMenu } from "./QuoteDestinationMenu";
import type { QuoteSource } from "@/lib/contextReferences";
import { useCallback, useEffect, useRef, useState } from "react";
import { CornerUpLeftIcon, MessagesSquareIcon } from "lucide-react";
import { TextSelectionMenu, type TextSelectionAction } from "./TextSelectionMenu";

export function SelectionPopup({
  containerRef,
  onReply,
  onAskInSideChat,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  onReply: (text: string) => void;
  // Present only when the session's harness supports side chat; renders the
  // "Ask in side chat" action beside Reply.
  onAskInSideChat?: (text: string) => void;
}) {
  const sourceId = useScopedConversationId();
  const sourceRef = useRef<QuoteSource | null>(null);
  const [destinationSource, setDestinationSource] = useState<
    (QuoteSource & { x: number; y: number }) | null
  >(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const selectedTextRef = useRef<string>("");

  const updatePopup = useCallback(() => {
    if (document.activeElement?.closest("[data-text-selection-menu]")) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPopupPos(null);
      selectedTextRef.current = "";
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      setPopupPos(null);
      selectedTextRef.current = "";
      return;
    }

    // Scope to the conversation container — ignore selections in the composer.
    const container = containerRef.current;
    if (!container) {
      setPopupPos(null);
      selectedTextRef.current = "";
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      setPopupPos(null);
      selectedTextRef.current = "";
      return;
    }

    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    // Anchor beside the first selected line, including multi-line selections.
    setPopupPos({
      x: rect.left,
      y: rect.top - 6,
    });
    selectedTextRef.current = text;
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const end =
      range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    const boundary = end?.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
    const first = start?.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
    const messageIds = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
      .filter((node) => range.intersectsNode(node))
      .map((node) => node.dataset.messageId!);
    sourceRef.current =
      sourceId && boundary && first
        ? {
            conversationId: sourceId,
            boundaryId: boundary,
            messageIds: [...new Set(messageIds)],
            text,
          }
        : null;
  }, [containerRef, sourceId]);

  useEffect(() => {
    document.addEventListener("mouseup", updatePopup);
    document.addEventListener("selectionchange", updatePopup);
    return () => {
      document.removeEventListener("mouseup", updatePopup);
      document.removeEventListener("selectionchange", updatePopup);
    };
  }, [updatePopup]);

  if (destinationSource)
    return (
      <QuoteDestinationMenu
        source={destinationSource}
        x={destinationSource.x}
        y={destinationSource.y}
        onClose={() => setDestinationSource(null)}
      />
    );
  if (!popupPos) return null;

  const close = () => {
    setPopupPos(null);
    selectedTextRef.current = "";
  };
  const select = (action: (text: string) => void) => () => {
    const text = selectedTextRef.current;
    if (text) action(text);
    window.getSelection()?.removeAllRanges();
  };
  const actions: TextSelectionAction[] = [
    { label: "Reply ↵", icon: <CornerUpLeftIcon />, onSelect: select(onReply) },
  ];
  if (sourceRef.current)
    actions.push({
      label: "Use in chat…",
      icon: <MessagesSquareIcon />,
      onSelect: () => {
        if (sourceRef.current) setDestinationSource({ ...sourceRef.current, ...popupPos });
      },
    });
  else if (onAskInSideChat)
    actions.push({
      label: "Ask in side chat",
      icon: <MessagesSquareIcon />,
      onSelect: select(onAskInSideChat),
    });
  return <TextSelectionMenu {...popupPos} actions={actions} onClose={close} />;
}
