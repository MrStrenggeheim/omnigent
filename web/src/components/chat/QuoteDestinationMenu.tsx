import { useCallback, useContext, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { getEmbedRoot } from "@/lib/host";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContextReferenceNavigationContext } from "@/lib/contextReferenceNavigation";
import {
  captureReference,
  referenceRequest,
  searchReferenceChats,
  type ContextReference,
  type QuoteSource,
  type ReferenceChat,
} from "@/lib/contextReferences";
import { insertQuoteDraft, insertQuoteReference } from "@/lib/quoteDraftDestinations";
import { textSelectionMenuClassName } from "./TextSelectionMenu";

export function QuoteDestinationMenu({
  source,
  x,
  y,
  onClose,
  intent = "pick",
}: {
  source: QuoteSource;
  x: number;
  y: number;
  onClose: () => void;
  intent?: "pick" | "subchat";
}) {
  const navigation = useContext(ContextReferenceNavigationContext);
  const createdSubchat = useRef<string | null>(null);
  const autoStarted = useRef(false);
  const inserting = useRef(false);
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [chats, setChats] = useState<ReferenceChat[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<ContextReference | null>(null);
  useEffect(() => {
    if (source.file) return;
    let alive = true;
    captureReference(source.conversationId, null, "quote", {
      boundary_id: source.boundaryId,
      message_ids: source.messageIds,
      quote: source.text,
    }).then(
      (value) => {
        if (alive) setReference(value);
      },
      (failure) => {
        if (alive) setError(failure.message);
      },
    );
    return () => {
      alive = false;
    };
  }, [source]);
  const [destination, setDestination] = useState<ReferenceChat | "new" | null>(
    intent === "subchat" ? "new" : null,
  );
  useEffect(() => {
    if (intent === "subchat") return;
    const controller = new AbortController();
    searchReferenceChats(query, true, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setChats(page.data);
      },
      (failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      },
    );
    return () => controller.abort();
  }, [query, intent]);
  const insert = useCallback(async () => {
    if (!destination || inserting.current) return;
    inserting.current = true;
    setBusy(true);
    setError("");
    try {
      let targetId: string;
      if (!navigation) throw new Error("Conversation navigation is unavailable in this view");
      if (!source.file && !reference) throw new Error("The source snapshot is not ready");
      if (destination === "new") {
        if (!navigation?.createSubchat || !reference)
          throw new Error("Subchat creation is unavailable for this source");
        createdSubchat.current ??= await navigation.createSubchat({
          ...source,
          boundaryId: reference.boundary_id,
        });
        targetId = createdSubchat.current;
      } else targetId = destination.id;
      await referenceRequest(
        `/v1/sessions/${encodeURIComponent(source.conversationId)}/context-reference/check`,
        { destination_id: targetId, scope: "quote" },
      );
      if (reference) insertQuoteReference(targetId, reference);
      else
        insertQuoteDraft(
          targetId,
          `[File selection: ${JSON.stringify({ ...source.file, source_id: source.conversationId })}]\n${source.text}`,
        );
      navigation.openConversation(targetId, { beside: true });
      window.getSelection()?.removeAllRanges();
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      inserting.current = false;
      setBusy(false);
    }
  }, [destination, navigation, source, reference, onClose]);
  useEffect(() => {
    if (intent !== "subchat" || !reference || autoStarted.current) return;
    autoStarted.current = true;
    void insert();
  }, [intent, reference, insert]);
  return createPortal(
    <div
      data-text-selection-menu
      data-context-reference-picker
      role="dialog"
      aria-label={intent === "subchat" ? "Ask subchat" : "Send to"}
      className={`${textSelectionMenuClassName} w-80 max-w-[calc(100vw-1rem)] p-2`}
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 328)),
        top: Math.max(8, Math.min(y, window.innerHeight - 350)),
        maxHeight: "calc(100vh - 16px)",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {destination ? (
        <>
          <p className="p-2 text-sm">
            The quote will be copied to{" "}
            {destination === "new" ? "a new subchat" : destination.title}, visible to everyone with
            access, including future participants.
          </p>
          <Button disabled={busy || (!source.file && !reference)} onClick={() => void insert()}>
            {intent === "subchat" ? "Ask subchat…" : "Insert quote"}
          </Button>
          {intent !== "subchat" && (
            <Button variant="ghost" disabled={busy} onClick={() => setDestination(null)}>
              Back
            </Button>
          )}
        </>
      ) : (
        <>
          {navigation?.createSubchat && !source.file && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setDestination("new")}
            >
              New subchat
            </Button>
          )}
          {finding ? (
            <Input
              autoFocus
              aria-label="Find chat"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setFinding(true)}
            >
              Find chat…
            </Button>
          )}
          <div className="slim-scrollbar max-h-52 overflow-auto">
            {chats.map((chat) => (
              <Button
                key={chat.id}
                variant="ghost"
                className="h-auto w-full justify-start whitespace-normal text-left"
                onClick={() => setDestination(chat)}
              >
                {chat.title}
                {chat.parent_id ? ` · ${chat.id.slice(0, 8)}` : ""}
              </Button>
            ))}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="p-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button variant="ghost" disabled={busy} onClick={onClose}>
        Cancel
      </Button>
    </div>,
    getEmbedRoot() ?? document.body,
  );
}
