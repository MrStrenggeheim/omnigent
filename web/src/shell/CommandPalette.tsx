import { TooltipButton } from "@/components/ui/tooltip";
// ⌘K palette: Sessions (recent, or title matches), In messages (content matches), Actions.
// Sessions are searched server-side (one loaded page can't find older ones), so
// cmdk filtering is off and the static actions are filtered here.

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileIcon, SearchIcon, XIcon } from "lucide-react";
import { useWorkspaceFileSearch } from "@/hooks/useWorkspaceChangedFiles";
import { queryIdentity } from "@/lib/workbenchWorkspace";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { isElectronShell } from "@/lib/nativeBridge";
import {
  mergePaletteCommands,
  paletteWorkflowActions,
  type CommandPaletteFileTarget,
} from "@/workbench/paletteCommands";

import { searchActions, filterSearchActions, type ActionCommand } from "./contextSearch/actions";
import { useNavigate } from "@/lib/routing";
import {
  type ConversationsPage,
  useConversations,
  useSessionSearch,
} from "@/hooks/useConversations";
import { useIsMobileViewport } from "@/hooks/useIsMobileViewport";
import { BOOT_PROBE_TIMEOUT_MS } from "@/lib/bootCapabilities";
import { useServerInfo } from "@/lib/CapabilitiesContext";
import { cn } from "@/lib/utils";
import { isImeCompositionKeyEvent } from "@/lib/ime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { conversationDisplayLabel, getConversationAgentType } from "./sidebarNav";

export type { CommandPaletteFileTarget } from "@/workbench/paletteCommands";

export interface CommandPaletteProps {
  /** Captured resource scope; never inferred from active chat or surrounding context. */
  fileTarget?: CommandPaletteFileTarget;
  /** File paths are relative to target.folder, matching Explorer quick search. */
  onOpenFile?: (path: string, target: CommandPaletteFileTarget) => void;
  onFileSearch?: (query: string, target: CommandPaletteFileTarget) => void;
  onOpenProjects?: () => void;
  /** Captured actions supplied by the currently focused workbench view. */
  actions?: ActionCommand[];
  onMessageSearch?: (sessionId: string, query: string) => void;
  sessionsOnly?: boolean;
  onNavigate?: (path: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Flip the left (Conversations) sidebar — owned by AppShell. */
  onToggleLeftSidebar: () => void;
  /** Flip the right (Workspace) sidebar — owned by AppShell. */
  onToggleRightSidebar: () => void;
}

/** Debounce matches the sidebar search (300ms) so keystrokes don't each fetch. */
const SEARCH_DEBOUNCE_MS = 300;

/** Split `text` on case-insensitive occurrences of `query`, bolding the matches
    so a search hit is visible in the title / content snippet. Returns the raw
    text unchanged when the query is empty or doesn't occur (e.g. the snippet
    matched a stemmed form). */
function HighlightedText({ text, query }: { text: string; query: string }): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  // Escape regex metacharacters so a query like "a.b" matches literally.
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  const lower = q.toLowerCase();
  // Non-matches stay raw strings (React needs no key for those); each match is
  // keyed by its running offset so repeated terms get stable, unique keys
  // without leaning on the bare array index.
  let offset = 0;
  return parts.map((part) => {
    const at = offset;
    offset += part.length;
    return part.toLowerCase() === lower ? (
      <mark key={at} className="bg-transparent font-semibold text-foreground">
        {part}
      </mark>
    ) : (
      part
    );
  });
}

/** How many recent sessions to show before the user types, so the Actions
    group stays visible without scrolling. Typing lifts the cap. */
const IDLE_SESSION_LIMIT = 5;
const SESSION_SEARCH_PAGE_BATCH = 10;
const SESSION_SEARCH_RESULT_LIMIT = 50;
/** Rows per page of each search group; "Show more" loads the next page. */
const SEARCH_GROUP_PAGE_SIZE = 8;
/** Keys that move cmdk's selection; see `userMovedSelection`. */
const SELECTION_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

interface PaletteSession {
  id: string;
  label: string;
  agent: string;
  snippet: string | null;
}

/** Flatten list pages into palette rows, dropping archived and repeated ids. */
function paletteSessions(
  pages: readonly ConversationsPage[],
  excludeIds: ReadonlySet<string> = new Set(),
): PaletteSession[] {
  const seen = new Set(excludeIds);
  const out: PaletteSession[] = [];
  for (const page of pages) {
    for (const c of page.data) {
      if (c.archived || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({
        id: c.id,
        label: conversationDisplayLabel(c),
        agent: getConversationAgentType(c),
        // Present only when the match was in chat content (not the title);
        // the server omits it otherwise. Shown as a dimmed second line.
        snippet: c.search_snippet ?? null,
      });
    }
  }
  return out;
}

export function CommandPalette({
  fileTarget,
  onOpenFile,
  onFileSearch,
  onOpenProjects,
  actions: suppliedActions,
  onMessageSearch,
  sessionsOnly = false,
  onNavigate,
  open,
  onOpenChange,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: CommandPaletteProps) {
  const navigateRoute = useNavigate();
  const navigate = onNavigate ?? navigateRoute;
  const isMobile = useIsMobileViewport();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [pageLimit, setPageLimit] = useState(SESSION_SEARCH_PAGE_BATCH);

  // Reset the query when the palette closes so it reopens clean.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setPageLimit(SESSION_SEARCH_PAGE_BATCH);
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const close = (): void => onOpenChange(false);
  const dismissOnEscape = (event: KeyboardEvent | React.KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const nativeEvent = "nativeEvent" in event ? event.nativeEvent : event;
    if (!isImeCompositionKeyEvent({ nativeEvent })) close();
  };
  const serverInfo = useServerInfo();
  const isAdmin = useIsAdmin();
  const querySettled = query === debouncedQuery;
  const target = useMemo(
    () =>
      fileTarget
        ? {
            ...fileTarget,
            workspace: fileTarget.workspace ? { ...fileTarget.workspace } : undefined,
          }
        : undefined,
    [fileTarget],
  );
  const fileIdentity = queryIdentity(target?.workspace ?? null, target?.conversationId);
  const filesEnabled =
    open && !sessionsOnly && !!fileIdentity && !!onOpenFile && !!debouncedQuery.trim();
  const fileSearch = useWorkspaceFileSearch(
    target?.conversationId,
    debouncedQuery,
    undefined,
    undefined,
    { enabled: filesEnabled, workspace: target?.workspace ?? null },
    target?.folder ?? "",
  );
  const fileResults =
    filesEnabled && querySettled && !fileSearch.isPlaceholderData && !fileSearch.isError
      ? [
          ...new Map(
            (fileSearch.data?.files ?? [])
              .filter((file) => file.type === "file")
              .map((file) => [file.path, file]),
          ).values(),
        ]
      : [];
  const visibleFiles = fileResults.slice(0, 50);
  const workflowActions = useMemo(
    () =>
      paletteWorkflowActions({
        navigate,
        info: serverInfo,
        isAdmin,
        isDesktop: isElectronShell(),
        isMobile,
        onOpenProjects,
      }),
    [navigate, serverInfo, isAdmin, isMobile, onOpenProjects],
  );

  const actions = useMemo(
    () =>
      mergePaletteCommands(
        suppliedActions ?? searchActions({ navigate, onToggleLeftSidebar, onToggleRightSidebar }),
        [
          ...workflowActions,
          ...(target && fileIdentity && onFileSearch
            ? [
                {
                  id: "search-files",
                  label: "Advanced file search",
                  icon: SearchIcon,
                  keywords: ["files", "contents", "search", "include", "exclude", "glob"],
                  run: () => onFileSearch(query, target),
                },
              ]
            : []),
        ],
      ),
    [
      suppliedActions,
      navigate,
      onToggleLeftSidebar,
      onToggleRightSidebar,
      workflowActions,
      target,
      fileIdentity,
      onFileSearch,
      query,
    ],
  );
  const filteredActions = useMemo(
    () => (sessionsOnly ? [] : filterSearchActions(actions, query)),
    [actions, query, sessionsOnly],
  );

  const { data, isFetching, isError, refetch, hasNextPage, fetchNextPage, isFetchNextPageError } =
    useConversations("", false, { enabled: open });
  // Older servers ignore `search_scope`, so they get one mixed group instead.
  const groupedSearch = serverInfo !== "loading" && serverInfo.session_search_scope === true;
  const searching = debouncedQuery !== "";
  // Wait briefly for server info so a supporting server never gets the mixed
  // request; if it stalls, fall back to that request rather than never searching.
  const serverInfoLoading = serverInfo === "loading";
  const [serverInfoWaitExpired, setServerInfoWaitExpired] = useState(false);
  useEffect(() => {
    if (!serverInfoLoading || !searching || serverInfoWaitExpired) return;
    const timer = setTimeout(() => setServerInfoWaitExpired(true), BOOT_PROBE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [serverInfoLoading, searching, serverInfoWaitExpired]);
  const awaitingServerInfo = !sessionsOnly && serverInfoLoading && !serverInfoWaitExpired;
  const searchOptions = {
    enabled: open && searching && !awaitingServerInfo,
    limit: SEARCH_GROUP_PAGE_SIZE,
  };
  const titleSearch = useSessionSearch(
    debouncedQuery,
    sessionsOnly || groupedSearch ? "title" : "all",
    searchOptions,
  );
  const contentSearch = useSessionSearch(debouncedQuery, "content", {
    ...searchOptions,
    enabled: searchOptions.enabled && groupedSearch && !sessionsOnly,
  });
  const loadedPages = data?.pages.length ?? 0;
  useEffect(() => {
    if (
      open &&
      sessionsOnly &&
      !query &&
      hasNextPage &&
      loadedPages < pageLimit &&
      !isFetching &&
      !isError &&
      !isFetchNextPageError
    ) {
      void fetchNextPage();
    }
  }, [
    open,
    sessionsOnly,
    query,
    hasNextPage,
    loadedPages,
    pageLimit,
    isFetching,
    isError,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  const sessions = useMemo(() => {
    if (!querySettled) return [];
    if (searching)
      return titleSearch.isPlaceholderData ? [] : paletteSessions(titleSearch.data?.pages ?? []);
    const out = paletteSessions(data?.pages ?? []);
    if (sessionsOnly) return out;
    // The full first page would push Actions below the fold.
    return out.slice(0, IDLE_SESSION_LIMIT);
  }, [
    data,
    titleSearch.data,
    titleSearch.isPlaceholderData,
    querySettled,
    searching,
    sessionsOnly,
  ]);
  // Excludes title matches again in case a rename moved a session between the
  // two groups' requests: cmdk needs each item value to be unique.
  const contentSessions = useMemo(
    () =>
      !sessionsOnly && searching && querySettled && !contentSearch.isPlaceholderData
        ? paletteSessions(contentSearch.data?.pages ?? [], new Set(sessions.map((s) => s.id)))
        : [],
    [
      contentSearch.data,
      contentSearch.isPlaceholderData,
      querySettled,
      searching,
      sessionsOnly,
      sessions,
    ],
  );
  const visibleSessions =
    sessionsOnly && !searching ? sessions.slice(0, SESSION_SEARCH_RESULT_LIMIT) : sessions;
  const searchGroups = sessionsOnly ? [titleSearch] : [titleSearch, contentSearch];
  const recentFetching = sessionsOnly && !query && isFetching;
  const loadError = searching
    ? searchGroups.some((group) => group.isError)
    : isError || isFetchNextPageError;
  const loadMoreError = searching
    ? searchGroups.some((group) => group.isFetchNextPageError)
    : isFetchNextPageError;
  const searchFetching =
    (searching && awaitingServerInfo) || searchGroups.some((group) => group.isFetching);
  const retrying = searching
    ? searchGroups.some((group) => group.isError && group.isFetching)
    : isFetching;
  const retryLoad = (): void => {
    if (!searching) {
      void (isFetchNextPageError ? fetchNextPage() : refetch());
      return;
    }
    for (const group of searchGroups) {
      if (group.isFetchNextPageError) void group.fetchNextPage();
      else if (group.isError) void group.refetch();
    }
  };

  // The two search groups resolve independently, so a title match can render
  // above an already-highlighted content match. Keep the top row selected
  // until the user moves the selection for this query.
  const firstItemValue =
    visibleSessions[0]?.id ??
    contentSessions[0]?.id ??
    (visibleFiles[0] ? `file:${visibleFiles[0].path}` : undefined) ??
    (filteredActions[0] ? `action:${filteredActions[0].id}` : "");
  const [selectedValue, setSelectedValue] = useState("");
  const userMovedSelection = useRef(false);
  useEffect(() => {
    userMovedSelection.current = false;
  }, [open, debouncedQuery]);
  useEffect(() => {
    if (!userMovedSelection.current) setSelectedValue(firstItemValue);
  }, [firstItemValue, open, debouncedQuery]);

  const paletteLabel = sessionsOnly ? "Switch session" : "Command palette";
  const placeholder = sessionsOnly
    ? "Search sessions by name…"
    : fileIdentity
      ? "Search chats, files or commands…"
      : "Search sessions or run a command";

  const runAction = (action: ActionCommand): void => {
    close();
    action.run();
  };

  const goToSession = (id: string): void => {
    close();
    navigate(`/c/${id}`);
  };

  const renderSession = (s: PaletteSession, messageResult = false): React.ReactNode => (
    // pl-6 indents the label to line up with the icon-prefixed Action rows
    // below (their 16px icon + 8px gap), so the groups read as one column.
    <CommandItem
      key={s.id}
      value={s.id}
      onSelect={() => {
        if (!querySettled) return;
        if (messageResult && onMessageSearch) {
          close();
          onMessageSearch(s.id, debouncedQuery);
        } else goToSession(s.id);
      }}
      className="items-start pl-6"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-left">
          <HighlightedText text={s.label} query={sessionsOnly ? query : debouncedQuery} />
        </span>
        {s.snippet && (
          // Where the match was found in the chat body — the session is often
          // unidentifiable from the title alone.
          <span className="truncate text-left text-muted-foreground text-sm">
            <HighlightedText text={s.snippet} query={debouncedQuery} />
          </span>
        )}
      </div>
      <span className="ml-2 shrink-0 text-sm text-muted-foreground">{s.agent}</span>
    </CommandItem>
  );

  const renderShowMore = (
    scope: "title" | "content",
    group: typeof titleSearch,
    rows: readonly PaletteSession[],
  ): React.ReactNode =>
    group.hasNextPage &&
    !group.isFetchNextPageError && (
      <CommandItem
        value={`more:${scope}`}
        disabled={group.isFetchingNextPage}
        onSelect={() => {
          // This row vanishes after the last page, so park the selection on
          // the group's last row; the next ArrowDown reaches the new rows.
          userMovedSelection.current = true;
          const lastRow = rows.at(-1);
          if (lastRow) setSelectedValue(lastRow.id);
          void group.fetchNextPage();
        }}
        className="pl-6 text-muted-foreground"
      >
        {group.isFetchingNextPage ? "Loading…" : "Show more"}
      </CommandItem>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onEscapeKeyDown={dismissOnEscape}
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape" || !(event.target instanceof Element)) return;
          if (event.target.closest('[role="dialog"]') !== event.currentTarget) return;
          // A tooltip can consume Radix's document Escape before this dialog sees it.
          dismissOnEscape(event);
        }}
        // Mobile: a top-anchored full-screen sheet sized to --omnigent-viewport-height,
        // so the input and results sit above the soft keyboard. sm:max-w-full
        // overrides DialogContent's sm:max-w-sm between 640px and md.
        className={cn(
          "overflow-hidden p-0",
          isMobile
            ? "inset-x-0 top-0 h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 gap-0 rounded-none border-0 shadow-none sm:max-w-full"
            : "top-1/4 translate-y-0 rounded-xl sm:max-w-2xl",
        )}
        style={
          isMobile
            ? {
                top: 0,
                height: "var(--omnigent-viewport-height, 100dvh)",
                maxHeight: "var(--omnigent-viewport-height, 100dvh)",
                // Pad both insets: the macOS title bar or safe-top clears the window
                // controls or notch; safe-bottom keeps the last row above the home
                // indicator when the keyboard is closed (the viewport then spans it).
                paddingTop: "var(--mac-titlebar-height, var(--omnigent-safe-top, 0px))",
                paddingBottom: "var(--omnigent-safe-bottom, 0px)",
              }
            : undefined
        }
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{paletteLabel}</DialogTitle>
        {/* shouldFilter=false: the server filters sessions and we filter actions
            (see file header). vimBindings=false: keep Ctrl+K/J from doubling as
            list-nav on Win/Linux, where Ctrl+K is also the opener. */}
        {/* Command's base class is `size-full`, so it already fills the sheet. */}
        <Command
          shouldFilter={false}
          vimBindings={false}
          label={paletteLabel}
          value={selectedValue}
          onValueChange={setSelectedValue}
          onKeyDown={(event) => {
            if (SELECTION_KEYS.has(event.key)) userMovedSelection.current = true;
          }}
        >
          {isMobile ? (
            // Search field and an explicit close button share a top row; the
            // full-screen sheet has no ⌘K/Esc affordance the way the desktop
            // dialog does, so the X is how touch users dismiss it.
            <div className="flex items-center gap-1 p-1">
              <div className="min-w-0 flex-1">
                <CommandInput
                  value={query}
                  onValueChange={setQuery}
                  placeholder={placeholder}
                  data-testid="command-palette-input"
                />
              </div>
              <Button
                variant="ghost"
                size="icon-lg"
                className="shrink-0 rounded-full"
                onClick={close}
                aria-label="Close search"
              >
                <XIcon className="size-5 text-muted-foreground" />
              </Button>
            </div>
          ) : (
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={placeholder}
              data-testid="command-palette-input"
            />
          )}
          <CommandList
            className={isMobile ? "max-h-none flex-1" : undefined}
            // Hovering a row selects it in cmdk, which counts as the user's pick.
            onPointerMove={(event) => {
              if ((event.target as Element).closest("[cmdk-item]")) {
                userMovedSelection.current = true;
              }
            }}
          >
            {(loadError || recentFetching) && (
              <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                {loadError
                  ? loadMoreError
                    ? "Couldn't load more sessions."
                    : "Couldn't load sessions."
                  : "Loading sessions…"}
                {loadError && (
                  <TooltipButton
                    type="button"
                    className="ml-2 underline"
                    disabled={retrying}
                    onClick={retryLoad}
                  >
                    Retry
                  </TooltipButton>
                )}
              </p>
            )}
            {!loadError &&
              !recentFetching &&
              !(
                filesEnabled &&
                querySettled &&
                !fileSearch.isPlaceholderData &&
                (fileSearch.isError || fileSearch.data?.truncated)
              ) && (
                <CommandEmpty>
                  {searchFetching ||
                  (filesEnabled && (fileSearch.isFetching || fileSearch.isPlaceholderData))
                    ? "Searching…"
                    : "No results found"}
                </CommandEmpty>
              )}
            {sessions.length > 0 && (
              <CommandGroup heading="Sessions">
                {visibleSessions.map((session) => renderSession(session))}
                {searching && renderShowMore("title", titleSearch, visibleSessions)}
              </CommandGroup>
            )}
            {contentSessions.length > 0 && (
              <CommandGroup heading="In messages">
                {contentSessions.map((session) => renderSession(session, true))}
                {renderShowMore("content", contentSearch, contentSessions)}
              </CommandGroup>
            )}
            {filesEnabled && querySettled && fileSearch.isError && (
              <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                Couldn’t search files.
                <TooltipButton
                  type="button"
                  className="ml-2 underline"
                  disabled={fileSearch.isFetching}
                  onClick={() => void fileSearch.refetch()}
                >
                  Retry file search
                </TooltipButton>
              </p>
            )}
            {filesEnabled &&
              (fileSearch.isFetching || fileSearch.isPlaceholderData) &&
              visibleFiles.length === 0 && (
                <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                  Searching files…
                </p>
              )}
            {(visibleFiles.length > 0 ||
              (!sessionsOnly && target && fileIdentity && onFileSearch && query.trim())) && (
              <CommandGroup heading="Files">
                {visibleFiles.map((file) => (
                  <CommandItem
                    key={file.path}
                    value={`file:${file.path}`}
                    onSelect={() => {
                      if (!querySettled || !target || !onOpenFile || fileSearch.isPlaceholderData)
                        return;
                      close();
                      onOpenFile(file.path, target);
                    }}
                  >
                    <FileIcon />
                    <span className="truncate text-left">
                      <HighlightedText text={file.path} query={debouncedQuery} />
                    </span>
                  </CommandItem>
                ))}
                {target && onFileSearch && (
                  <CommandItem
                    value="file:advanced"
                    onSelect={() => {
                      close();
                      onFileSearch(query, target);
                    }}
                  >
                    <SearchIcon />
                    Search file contents…
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            {filesEnabled &&
              querySettled &&
              !fileSearch.isPlaceholderData &&
              (fileSearch.data?.truncated || fileResults.length > visibleFiles.length) && (
                <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                  File results are limited. Narrow the query
                  {onFileSearch ? " or use advanced file search" : ""}.
                </p>
              )}
            {sessionsOnly && sessions.length > visibleSessions.length && (
              <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                Showing {visibleSessions.length} of {sessions.length} matches. Type more to narrow
                your search.
              </p>
            )}
            {sessionsOnly && !query && hasNextPage && loadedPages >= pageLimit && !loadError && (
              <Button
                variant="ghost"
                className="w-full"
                disabled={isFetching}
                onClick={() => setPageLimit(loadedPages + SESSION_SEARCH_PAGE_BATCH)}
              >
                Search older sessions
              </Button>
            )}
            {filteredActions.length > 0 && (
              <CommandGroup heading="Actions">
                {filteredActions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <CommandItem key={a.id} value={`action:${a.id}`} onSelect={() => runAction(a)}>
                      <Icon />
                      <span className="flex-1 truncate text-left">{a.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
