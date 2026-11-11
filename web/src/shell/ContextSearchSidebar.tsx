import { usePanelEscapeClose } from "@/hooks/usePanelEscapeClose";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, SearchIcon, XIcon } from "lucide-react";
import { TooltipButton } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { conversationDisplayLabel } from "./sidebarNav";
import { useContextSearch } from "./ContextSearchContext";
import { MessageSearchError } from "@/hooks/useMessageSearch";
import {
  targetKey,
  type ContextSearchCategory,
  type MessageSearchHit,
} from "./contextSearch/types";

/** Search excerpts are text only: never load linked images, attachments or HTML. */
export function readableSearchSnippet(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```[^\n]*\n?|```|~~~[^\n]*\n?|~~~/g, "")
    .replace(/(^|\n)\s*(?:#{1,6}\s+|>\s?)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .trim();
}

export function SearchExcerpt({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  let offset = 0;
  return parts.map((part) => {
    const start = offset;
    offset += part.length;
    return part.toLowerCase() === query.toLowerCase() ? (
      <mark key={start} className="rounded-sm bg-amber-200/70 text-inherit dark:bg-amber-400/30">
        {part}
      </mark>
    ) : (
      part
    );
  });
}

/** Protect source ranges before abbreviating Markdown so literal punctuation stays visible. */
export function MessageSearchExcerpt({ hit }: { hit: MessageSearchHit }): ReactNode {
  let prefix = "\uE000";
  while (hit.snippet.includes(prefix)) prefix += "\uE000";
  const matches: string[] = [];
  let cursor = 0;
  let protectedText = "";
  for (const range of hit.ranges) {
    const start = Math.max(range.start - hit.snippet_start, 0);
    const end = Math.min(range.end - hit.snippet_start, hit.snippet.length);
    if (end <= start || start < cursor) continue;
    protectedText += hit.snippet.slice(cursor, start) + `${prefix}${matches.length}\uE001`;
    matches.push(hit.snippet.slice(start, end));
    cursor = end;
  }
  protectedText += hit.snippet.slice(cursor);
  const parts = readableSearchSnippet(protectedText).split(
    new RegExp(`${prefix}(\\d+)\uE001`, "g"),
  );
  return parts.map((part, index) =>
    index % 2 ? (
      <mark key={part} className="rounded-sm bg-amber-200/70 text-inherit dark:bg-amber-400/30">
        {matches[Number(part)]}
      </mark>
    ) : (
      part
    ),
  );
}

function hitKey(hit: MessageSearchHit): string {
  return `message:${hit.session_id}:${hit.item_id}`;
}
const categories: { id: ContextSearchCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "messages", label: "Messages" },
  { id: "titles", label: "Chats" },
  { id: "actions", label: "Actions" },
];
const rowClass =
  "w-full min-w-0 rounded-md px-2 py-2 text-left text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent";

export function ContextSearchSidebar() {
  const search = useContextSearch();
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [keyboardSelection, setKeyboardSelection] = useState("");
  const open = search?.open ?? false;
  const focusRequest = search?.focusRequest;
  usePanelEscapeClose(open, search?.close, { scope: root, capture: true });
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open, focusRequest]);
  useEffect(() => setKeyboardSelection(""), [search?.query, search?.scope, search?.category]);
  useEffect(() => {
    if (results.current) results.current.scrollTop = 0;
  }, [search?.settledQuery, search?.scope, search?.category]);
  useEffect(() => setKeyboardSelection(""), [search?.highlightTarget?.requestId]);
  const highlightKey = targetKey(search?.highlightTarget ?? null);
  useEffect(() => {
    if (!open) return;
    const selected = results.current?.querySelector<HTMLElement>('[data-search-selected="true"]');
    selected?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlightKey, keyboardSelection]);

  const groups = useMemo(() => {
    const grouped = new Map<string, MessageSearchHit[]>();
    for (const hit of search?.hits ?? []) {
      const group = grouped.get(hit.session_id) ?? [];
      group.push(hit);
      grouped.set(hit.session_id, group);
    }
    return [...grouped.entries()];
  }, [search?.hits]);
  if (!search?.open) return null;
  const showMessages = search.category === "all" || search.category === "messages";
  const showTitles = search.category === "all" || search.category === "titles";
  const showActions = search.category === "all" || search.category === "actions";
  const activations = new Map<string, () => void>();
  if (showMessages && search.queryReady)
    for (const hit of search.hits) {
      const range = hit.ranges[0];
      if (range) activations.set(hitKey(hit), () => search.activate({ hit, range }));
    }
  if (showTitles && search.queryReady)
    for (const hit of search.titleHits)
      activations.set(`title:${hit.id}`, () => search.goToTitle(hit.id));
  if (showActions)
    for (const action of search.actions) activations.set(`action:${action.id}`, action.run);
  const keys = [...activations.keys()];
  const selectedKey =
    keyboardSelection ||
    (search.highlightTarget
      ? `message:${search.highlightTarget.conversationId}:${search.highlightTarget.itemId}`
      : (keys[0] ?? ""));
  const loading = !search.queryReady || search.messages.isFetching || search.titles.isFetching;
  const error = search.messages.error;
  const unavailable = error instanceof MessageSearchError && [404, 501].includes(error.status);
  const hasResults =
    (showMessages && search.hits.length > 0) ||
    (showTitles && search.titleHits.length > 0) ||
    (showActions && search.actions.length > 0);

  return (
    <section
      ref={root}
      aria-label="Chat search"
      data-testid="context-search-sidebar"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          search.close();
        }
      }}
    >
      <div className="shrink-0 space-y-3 px-3 pt-2 pb-3">
        <div className="flex items-center justify-between text-ui font-medium">
          <span>Search</span>
          <TooltipButton
            type="button"
            aria-label="Close search"
            tooltipShortcut={["Esc"]}
            onClick={search.close}
            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent"
          >
            <ArrowLeftIcon className="size-4 md:hidden" />
            <XIcon className="hidden size-4 md:block" />
          </TooltipButton>
        </div>
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground"
          />
          <Input
            ref={input}
            value={search.query}
            aria-label="Search chats"
            placeholder="Search chats…"
            className="pl-8 pr-8"
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.defaultPrevented) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const index = keys.indexOf(selectedKey);
                const direction = event.key === "ArrowDown" ? 1 : -1;
                const next =
                  index < 0
                    ? direction === 1
                      ? 0
                      : keys.length - 1
                    : (index + direction + keys.length) % keys.length;
                setKeyboardSelection(keys[next] ?? "");
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (search.scope === "current") search.move(event.shiftKey ? -1 : 1);
                else activations.get(selectedKey || keys[0])?.();
              }
            }}
          />
          {search.query && (
            <TooltipButton
              type="button"
              aria-label="Clear search query"
              onClick={() => {
                search.setQuery("");
                input.current?.focus();
              }}
              className="absolute top-0 right-0 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </TooltipButton>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Search in</span>
          <SegmentedControl
            aria-label="Search scope"
            className="h-auto min-h-6 max-w-full flex-wrap"
          >
            {(
              [
                ["current", "Current chat"],
                ["all", "All chats"],
              ] as const
            ).map(([scope, label]) => (
              <SegmentedControlItem
                key={scope}
                label={label}
                active={search.scope === scope}
                disabled={scope === "current" && !search.activeSessionId}
                onClick={() => search.setScope(scope)}
              >
                {label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        <SegmentedControl
          aria-label="Search categories"
          className="h-auto min-h-6 max-w-full flex-wrap"
        >
          {categories.map(({ id, label }) => (
            <SegmentedControlItem
              key={id}
              label={label}
              active={search.category === id}
              onClick={() => search.setCategory(id)}
            >
              {label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      <div
        ref={results}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
        aria-label="Search results"
      >
        {!search.query.trim() && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Find messages, chats and actions.
          </p>
        )}
        {!!search.query.trim() && loading && (
          <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
            Searching…
          </p>
        )}
        {search.unavailable && (
          <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
            {search.unavailable}
          </p>
        )}
        {showMessages && !!search.settledQuery && (
          <>
            <div className="flex justify-between gap-2 px-2 py-2 text-xs text-muted-foreground">
              <span>Messages</span>
              <span>
                {search.hits.length}
                {search.messages.hasNextPage ? "+" : ""} messages · {groups.length}
                {search.messages.hasNextPage ? "+" : ""} chats
              </span>
            </div>
            {groups.map(([id, hits]) => (
              <div key={id} className="mb-3">
                <div
                  className="truncate px-2 py-1 text-xs font-medium"
                  title={hits[0].title ?? "Untitled chat"}
                >
                  {hits[0].title ?? "Untitled chat"}
                </div>
                {hits.map((hit) => {
                  const key = hitKey(hit);
                  const selected = key === selectedKey;
                  return (
                    <TooltipButton
                      key={key}
                      type="button"
                      data-search-selected={selected}
                      aria-pressed={selected}
                      disabled={!search.queryReady || !hit.ranges.length}
                      onClick={() => {
                        setKeyboardSelection("");
                        activations.get(key)?.();
                      }}
                      className={cn(
                        rowClass,
                        "my-0.5 border border-transparent disabled:opacity-50",
                        selected && "border-primary/25 bg-accent",
                      )}
                      tooltip="Open matching message"
                    >
                      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="capitalize">{hit.role}</span>
                        <span>
                          {hit.created_at == null
                            ? ""
                            : new Date(hit.created_at * 1000).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                        </span>
                      </span>
                      <span className="mt-1 block line-clamp-3 whitespace-pre-wrap break-words leading-relaxed">
                        <MessageSearchExcerpt hit={hit} />
                      </span>
                      {hit.occurrence_count > 1 && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {hit.occurrence_count}
                          {hit.text_truncated ? "+" : ""} occurrences
                        </span>
                      )}
                    </TooltipButton>
                  );
                })}
              </div>
            ))}
            {error && (
              <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
                {unavailable
                  ? "Message search is unavailable on this server."
                  : search.messages.isFetchNextPageError
                    ? "Couldn't load more messages."
                    : "Couldn't search messages."}{" "}
                <TooltipButton
                  type="button"
                  className="underline"
                  disabled={search.messages.isFetching}
                  onClick={() => {
                    void (search.messages.isFetchNextPageError
                      ? search.messages.fetchNextPage()
                      : search.messages.refetch());
                  }}
                >
                  Retry
                </TooltipButton>
              </p>
            )}
            {search.messages.hasNextPage && !search.messages.isFetchNextPageError && (
              <TooltipButton
                type="button"
                className="w-full rounded px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
                disabled={search.messages.isFetching}
                onClick={() => {
                  void search.messages.fetchNextPage();
                }}
              >
                {search.messages.isFetchingNextPage ? "Loading…" : "Show more messages"}
              </TooltipButton>
            )}
          </>
        )}
        {showTitles && !!search.settledQuery && (
          <>
            <p className="px-2 py-2 text-xs text-muted-foreground">Chats</p>
            {search.titleHits.map((hit) => (
              <TooltipButton
                key={hit.id}
                type="button"
                className={cn(rowClass, selectedKey === `title:${hit.id}` && "bg-accent")}
                data-search-selected={selectedKey === `title:${hit.id}`}
                disabled={!search.queryReady}
                onClick={() => search.goToTitle(hit.id)}
              >
                <SearchExcerpt text={conversationDisplayLabel(hit)} query={search.settledQuery} />
              </TooltipButton>
            ))}
            {search.titles.isError && (
              <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
                Couldn't load chats.{" "}
                <TooltipButton
                  type="button"
                  className="underline"
                  onClick={() => {
                    void (search.titles.isFetchNextPageError
                      ? search.titles.fetchNextPage()
                      : search.titles.refetch());
                  }}
                >
                  Retry
                </TooltipButton>
              </p>
            )}
            {search.titles.hasNextPage && (
              <TooltipButton
                type="button"
                className={rowClass}
                disabled={search.titles.isFetching}
                onClick={() => {
                  void search.titles.fetchNextPage();
                }}
              >
                Show more chats
              </TooltipButton>
            )}
          </>
        )}
        {showActions && search.actions.length > 0 && (
          <>
            <p className="px-2 py-2 text-xs text-muted-foreground">Actions</p>
            {search.actions.map((action) => (
              <TooltipButton
                key={action.id}
                type="button"
                data-search-selected={selectedKey === `action:${action.id}`}
                className={cn(
                  rowClass,
                  "flex items-center gap-2",
                  selectedKey === `action:${action.id}` && "bg-accent",
                )}
                onClick={action.run}
              >
                <action.icon className="size-4 shrink-0" />
                <span>{action.label}</span>
              </TooltipButton>
            ))}
          </>
        )}
        {!!search.query.trim() && !loading && !hasResults && !error && !search.titles.isError && (
          <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
            No results found.
          </p>
        )}
      </div>
    </section>
  );
}
