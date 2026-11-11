import { useEffect, useState, useRef, type ComponentProps } from "react";
import { FileMentionMenu } from "@/components/FileMentionMenu";
import { Button } from "@/components/ui/button";
import {
  captureReference,
  referenceRequest,
  searchReferenceChats,
  type ContextReference,
  type ReferenceChat,
  type ReferenceItem,
  type ReferenceScope,
} from "@/lib/contextReferences";
import { ContextReferencePreview } from "./ContextReferencePreview";

export function ComposerMentionMenu({
  query,
  destinationId,
  onReference,
  ...files
}: ComponentProps<typeof FileMentionMenu> & {
  query: string;
  destinationId: string | null;
  onReference: (reference: ContextReference) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const [chatCursor, setChatCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<"Files" | "Chats" | "Messages">("Files");
  const [chats, setChats] = useState<ReferenceChat[]>([]);
  const [chat, setChat] = useState<ReferenceChat | null>(null);
  const [messages, setMessages] = useState<ReferenceItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [reference, setReference] = useState<ContextReference | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (tab === "Files") return;
    const controller = new AbortController();
    generation.current += 1;
    setLoading(true);
    setError("");
    setChat(null);
    setChoosing(false);
    searchReferenceChats(query, false, controller.signal, undefined, tab === "Messages")
      .then(
        (page) => {
          if (!controller.signal.aborted) {
            setChats(page.data);
            setChatCursor(page.has_more ? page.next_cursor : null);
          }
        },
        (failure) => {
          if (!controller.signal.aborted) setError(String(failure.message));
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tab, query]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      const composer = menuRef.current?.closest("form") ?? menuRef.current?.parentElement;
      if (!composer?.contains(event.target)) return;
      if (
        (event.key === "Tab" &&
          !event.shiftKey &&
          (tab !== "Files" || files.entries.length === 0)) ||
        (tab !== "Files" && ["Enter", "ArrowDown", "ArrowUp"].includes(event.key))
      ) {
        event.preventDefault();
        event.stopPropagation();
        menuRef.current
          ?.querySelector<HTMLButtonElement>(
            tab === "Files" ? '[role="tab"]' : 'button:not([role="tab"])',
          )
          ?.focus();
      }
    };
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [tab, files.entries.length]);
  const loadMessages = async (source: ReferenceChat, after?: string) => {
    const requestGeneration = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50", order: "desc" });
      if (after) params.set("after", after);
      const page = await referenceRequest<{
        data: ReferenceItem[];
        has_more: boolean;
        last_id: string;
      }>(`/v1/sessions/${encodeURIComponent(source.id)}/items?${params}`);
      if (generation.current !== requestGeneration) return;
      setMessages((previous) => (after ? [...previous, ...page.data] : page.data));
      setCursor(page.has_more ? page.last_id : null);
      setChoosing(true);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const capture = async (scope: ReferenceScope) => {
    if (!chat) return;
    const requestGeneration = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await captureReference(chat.id, destinationId, scope, {
        message_ids: selected,
      });
      if (generation.current === requestGeneration) setReference(result);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div
      ref={menuRef}
      data-context-reference-picker
      onMouseDown={(event) => event.preventDefault()}
      className="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-2 shadow-menu"
    >
      <div className="flex gap-1" role="tablist" aria-label="Reference type">
        {(["Files", "Chats", "Messages"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={tab === value ? "secondary" : "ghost"}
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              generation.current += 1;
              setTab(value);
              setReference(null);
              setSelected([]);
            }}
          >
            {value}
          </Button>
        ))}
      </div>
      {tab === "Files" ? (
        <div className="relative mt-2 min-h-10 [&>div]:static [&>div>div]:w-full [&>div>div]:border-0 [&>div>div]:shadow-none">
          <FileMentionMenu {...files} />
          {files.entries.length === 0 && !files.loading && (
            <p className="p-2 text-sm">No matching files</p>
          )}
        </div>
      ) : (
        <div className="max-h-72 overflow-auto">
          {!chat ? (
            chats.map((row) => (
              <Button
                key={`${row.id}:${row.message_id ?? ""}`}
                variant="ghost"
                className="h-auto w-full justify-start whitespace-normal text-left"
                onClick={() => {
                  setChat(row);
                  setSelected([]);
                  if (row.message_id) {
                    const requestGeneration = ++generation.current;
                    setLoading(true);
                    captureReference(row.id, destinationId, "messages", {
                      message_ids: [row.message_id],
                    })
                      .then(
                        (result) => {
                          if (generation.current === requestGeneration) setReference(result);
                        },
                        (failure) => setError(failure.message),
                      )
                      .finally(() => setLoading(false));
                  } else if (tab === "Messages") void loadMessages(row);
                }}
              >
                {row.title}
                {row.snippet ? ` · ${row.snippet}` : ""}
                {row.parent_id ? ` · subchat ${row.id.slice(0, 8)}` : ""}
              </Button>
            ))
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  generation.current += 1;
                  setChat(null);
                  setChoosing(false);
                }}
              >
                ‹ {chat.title}
              </Button>
              {!choosing ? (
                <div className="flex flex-col items-start">
                  <Button variant="ghost" disabled={loading} onClick={() => void capture("whole")}>
                    Whole chat
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={loading}
                    onClick={() => void capture("last_answer")}
                  >
                    Last completed answer
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={loading}
                    onClick={() => void loadMessages(chat)}
                  >
                    Choose messages
                  </Button>
                </div>
              ) : (
                <>
                  {messages
                    .filter((item) => item.type === "message")
                    .filter(
                      (item) =>
                        tab !== "Messages" ||
                        !query ||
                        JSON.stringify(item.content).toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((item) => (
                      <label
                        key={item.id}
                        className="flex gap-2 p-2 text-sm"
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, item.id]
                                : current.filter((id) => id !== item.id),
                            )
                          }
                        />
                        <span className="line-clamp-3">
                          {item.created_by ?? item.role}:{" "}
                          {item.content?.map((block) => block.text ?? `[${block.type}]`).join("\n")}
                        </span>
                      </label>
                    ))}
                  {cursor && (
                    <Button
                      variant="ghost"
                      disabled={loading}
                      onClick={() => void loadMessages(chat, cursor)}
                    >
                      Earlier messages
                    </Button>
                  )}
                  <Button
                    disabled={loading || !selected.length}
                    onClick={() => void capture("messages")}
                  >
                    Preview selection
                  </Button>
                </>
              )}
            </>
          )}
          {!loading && !chats.length && !chat && <p className="p-2 text-sm">No matching chats</p>}
        </div>
      )}
      {tab !== "Files" && !chat && chatCursor && (
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            searchReferenceChats(query, false, undefined, chatCursor, tab === "Messages")
              .then(
                (page) => {
                  setChats((previous) => [...previous, ...page.data]);
                  setChatCursor(page.has_more ? page.next_cursor : null);
                },
                (failure) => setError(failure.message),
              )
              .finally(() => setLoading(false));
          }}
        >
          More chats
        </Button>
      )}
      {loading && (
        <p role="status" className="p-2 text-sm">
          Loading…
        </p>
      )}
      {error && (
        <p role="alert" className="p-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {reference && (
        <ContextReferencePreview
          reference={reference}
          onClose={() => setReference(null)}
          onAttach={() => onReference(reference)}
        />
      )}
    </div>
  );
}
