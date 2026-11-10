import { useEffect, useMemo, useRef, useState } from "react";
import { releaseConversationScrollLock } from "@/components/ai-elements/conversation";
import { useChatStore } from "@/store/chatStore";
import type { Bubble } from "@/lib/renderItems";
import { findMessageElement } from "@/lib/messageDeepLink";
import type { ContextSearchTarget } from "@/shell/contextSearch/types";
import {
  CHAT_SEARCH_BODY_SELECTOR,
  chatQueryRanges,
  chatSearchSources,
  clearChatSearchHighlights,
  paintChatSearchHighlights,
  searchSourceElement,
  sourceOccurrenceRange,
} from "@/lib/chatSearchHighlights";
import "@/components/chat/chatSearchHighlights.css";

export interface ChatSearchResolution {
  target: ContextSearchTarget;
  status: "resolved" | "unavailable";
}

export interface ChatSearchHighlightOptions {
  conversationId: string | null;
  query: string;
  target: ContextSearchTarget | null;
  onResolved?: (result: ChatSearchResolution) => void;
  container: Element | null;
  scrollElement: HTMLElement | null;
  bubbles: readonly Bubble[];
  ensureMessageVisible: (id: string) => boolean;
  ready: boolean;
  rangeNonce?: number;
}

/** Refresh paints only; a new activation identity alone may move the viewport. */
export function useChatSearchHighlights(options: ChatSearchHighlightOptions): void {
  const {
    conversationId,
    query,
    target,
    container,
    scrollElement,
    bubbles,
    ensureMessageVisible,
    ready,
    rangeNonce,
  } = options;
  const sources = useMemo(() => chatSearchSources(bubbles), [bubbles]);
  const loadingConversation = useChatStore((s) => s.loadingConversation);
  const loadingMoreHistory = useChatStore((s) => s.loadingMoreHistory);
  const hasMoreHistory = useChatStore((s) => s.hasMoreHistory);
  const oldestItemId = useChatStore((s) => s.oldestItemId);
  const historyGeneration = useChatStore((s) => s.historyGeneration);
  const [revision, setRevision] = useState(0);
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const activation = target
    ? JSON.stringify(
        target.requestId !== undefined
          ? [target.conversationId, target.requestId]
          : [
              target.conversationId,
              target.itemId,
              target.range.start,
              target.range.end,
              target.textStart ?? 0,
              query,
            ],
      )
    : null;
  const progress = useRef<{
    key: string | null;
    done: boolean;
    pageCursor?: string | null;
    mounting?: string;
    sourceText?: string;
    invalidated?: boolean;
    renderDeadline?: number;
    retryScheduled?: boolean;
    expandedPrompt?: boolean;
  }>({ key: null, done: false });

  // Streaming Markdown, code highlighting and virtual rows can update after the
  // store commit. Observe text/layout ownership without touching React's nodes.
  useEffect(() => {
    if (!container || !query) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setRevision((value) => value + 1);
      });
    });
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [container, query]);

  useEffect(() => () => clearChatSearchHighlights(), [container, conversationId]);

  useEffect(() => {
    if (progress.current.key !== activation) progress.current = { key: activation, done: false };
    const current = progress.current;
    const all =
      container && query
        ? Array.from(
            container.querySelectorAll(`[data-message-id] :is(${CHAT_SEARCH_BODY_SELECTOR})`),
          ).flatMap((element) => chatQueryRanges(element, query))
        : [];
    const paint = (active: Range | null) => paintChatSearchHighlights(all, active);
    paint(null);
    if (
      !container ||
      !target ||
      !query ||
      target.conversationId !== conversationId ||
      !ready ||
      loadingConversation
    )
      return;
    const report = (status: ChatSearchResolution["status"]) => {
      if (
        !mounted.current ||
        progress.current !== current ||
        latest.current.conversationId !== target.conversationId ||
        latest.current.target?.requestId !== target.requestId ||
        latest.current.target?.itemId !== target.itemId
      )
        return;
      current.done = true;
      current.invalidated = status === "unavailable";
      latest.current.onResolved?.({ target, status });
    };
    if (current.invalidated) return;
    const awaitRender = () => {
      current.renderDeadline ??= performance.now() + 500;
      if (performance.now() >= current.renderDeadline) {
        report("unavailable");
        return;
      }
      if (current.retryScheduled) return;
      current.retryScheduled = true;
      window.setTimeout(() => {
        current.retryScheduled = false;
        if (mounted.current && progress.current === current) setRevision((value) => value + 1);
      }, 50);
    };
    const source = sources.find((value) => value.itemId === target.itemId);
    if (!source) {
      if (current.done) {
        if (current.sourceText !== undefined) report("unavailable");
        return;
      }
      if (loadingMoreHistory) return;
      if (!hasMoreHistory || current.pageCursor === oldestItemId) {
        report("unavailable");
        return;
      }
      current.pageCursor = oldestItemId;
      void useChatStore
        .getState()
        .loadMoreHistory()
        .then(
          () => {
            if (mounted.current && progress.current === current) setRevision((value) => value + 1);
          },
          () => {
            if (progress.current === current) report("unavailable");
          },
        );
      return;
    }
    const from = target.textStart ?? 0;
    if (
      from < 0 ||
      source.text.slice(from, from + target.sourceText.length) !== target.sourceText ||
      (current.sourceText !== undefined && current.sourceText !== source.text)
    ) {
      if (!current.invalidated) {
        current.invalidated = true;
        report("unavailable");
      }
      return;
    }
    current.sourceText = source.text;
    const element = searchSourceElement(container, source);
    if (!element) {
      if (current.done) return;
      if (current.mounting !== source.rowId) {
        current.mounting = source.rowId;
        if (ensureMessageVisible(source.rowId)) {
          requestAnimationFrame(() => {
            if (mounted.current && progress.current === current) setRevision((value) => value + 1);
          });
          return;
        }
      }
      awaitRender();
      return;
    }
    const { start, end } = target.range;
    if (start < 0 || end > target.sourceText.length) {
      if (!current.done) report("unavailable");
      return;
    }
    const range = sourceOccurrenceRange(element, source.text, from + start, from + end);
    if (!range) {
      if (!current.done) {
        if (!current.expandedPrompt && source.itemId === source.rowId) {
          const expand = Array.from(
            findMessageElement(source.rowId, container)?.querySelectorAll("button") ?? [],
          ).find((button) => button.textContent?.startsWith("Show full prompt ("));
          if (expand) {
            current.expandedPrompt = true;
            expand.click();
          }
        }
        awaitRender();
      }
      return;
    }
    if (
      !chatQueryRanges(element, query).some(
        (match) =>
          match.compareBoundaryPoints(Range.START_TO_START, range) === 0 &&
          match.compareBoundaryPoints(Range.END_TO_END, range) === 0,
      )
    ) {
      if (!current.done) report("unavailable");
      return;
    }
    paint(range);
    if (current.done) return;
    current.done = true;
    releaseConversationScrollLock();
    if (scrollElement) {
      const bounds = range.getBoundingClientRect();
      const viewport = scrollElement.getBoundingClientRect();
      scrollElement.scrollBy({
        top: bounds.top - viewport.top - (viewport.height - bounds.height) / 2,
        behavior: "auto",
      });
    }
    report("resolved");
  }, [
    activation,
    conversationId,
    query,
    target,
    container,
    scrollElement,
    sources,
    ensureMessageVisible,
    ready,
    rangeNonce,
    loadingConversation,
    loadingMoreHistory,
    hasMoreHistory,
    oldestItemId,
    historyGeneration,
    revision,
  ]);
}
