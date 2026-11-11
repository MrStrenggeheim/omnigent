import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BubbleView } from "@/components/chat/chatBubbleParts";
import type * as ConversationModule from "@/components/ai-elements/conversation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bubble } from "@/lib/renderItems";
import { useChatStore } from "@/store/chatStore";
import { CHAT_SEARCH_ACTIVE_HIGHLIGHT, CHAT_SEARCH_HIGHLIGHT } from "@/lib/chatSearchHighlights";
import {
  useChatSearchHighlights,
  type ChatSearchHighlightOptions,
  type ChatSearchResolution,
} from "./useChatSearchHighlights";

const releaseScrollLock = vi.hoisted(() => vi.fn());
vi.mock("@/components/ai-elements/conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof ConversationModule>()),
  releaseConversationScrollLock: releaseScrollLock,
}));

function user(itemId: string, text: string): Bubble {
  return { kind: "user", itemId, content: [{ type: "input_text", text }] };
}

const highlights = new Map<string, { ranges: Range[] }>();
let options: ChatSearchHighlightOptions;
let root: HTMLDivElement;
let scrollBy: ReturnType<typeof vi.fn<(options?: ScrollToOptions) => void>>;
let onResolved: ReturnType<typeof vi.fn<(result: ChatSearchResolution) => void>>;
function markup(itemId = "old", text = "😀 echo echo") {
  return `<div data-message-id="${itemId}"><p class="message-markdown">${text}</p></div>`;
}

beforeEach(() => {
  root = document.createElement("div");
  root.innerHTML = markup();
  document.body.append(root);
  scrollBy = vi.fn();
  Object.defineProperty(root, "scrollBy", { configurable: true, value: scrollBy });
  onResolved = vi.fn();
  releaseScrollLock.mockClear();
  highlights.clear();
  vi.stubGlobal(
    "Highlight",
    class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    },
  );
  Object.defineProperty(CSS, "highlights", { configurable: true, value: highlights });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 100, height: 20 }) as DOMRect,
  });
  root.getBoundingClientRect = () => ({ top: 0, height: 200 }) as DOMRect;
  useChatStore.setState({
    loadingConversation: false,
    loadingMoreHistory: false,
    hasMoreHistory: false,
    oldestItemId: "old",
    historyGeneration: 0,
  });
  options = {
    conversationId: "chat",
    query: "echo",
    container: root,
    scrollElement: root,
    bubbles: [user("old", "😀 echo echo")],
    ready: true,
    ensureMessageVisible: vi.fn(() => false),
    onResolved,
    target: {
      conversationId: "chat",
      itemId: "old",
      range: { start: 8, end: 12 },
      sourceText: "😀 echo echo",
      content_hash: "original",
      requestId: 1,
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("chat search navigation", () => {
  it("keeps an active exact match when another conversation mounts, updates and unmounts", () => {
    renderHook(() => useChatSearchHighlights(options));
    const active = highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges[0];
    expect(active?.toString()).toBe("echo");
    const other = document.createElement("div");
    other.innerHTML = markup();
    document.body.append(other);
    const inactive = {
      ...options,
      conversationId: "other",
      query: "",
      target: null,
      container: other,
    };
    const { rerender, unmount } = renderHook((value) => useChatSearchHighlights(value), {
      initialProps: inactive,
    });
    rerender({ ...inactive, bubbles: [user("old", "echo changed")] });
    expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges[0]).toBe(active);
    unmount();
    expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges[0]).toBe(active);
    expect(onResolved).toHaveBeenCalledOnce();
  });

  it("scrolls the exact repeated occurrence once and preserves focus/manual scroll through refreshes", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const { rerender } = renderHook((value) => useChatSearchHighlights(value), {
      initialProps: options,
    });
    expect(onResolved).toHaveBeenCalledWith({ target: options.target, status: "resolved" });
    expect(scrollBy).toHaveBeenCalledWith({ top: 10, behavior: "auto" });
    expect(document.activeElement).toBe(input);
    expect(highlights.get(CHAT_SEARCH_HIGHLIGHT)?.ranges).toHaveLength(2);
    expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges[0].startOffset).toBe(8);
    root.scrollTop = 777;
    rerender({
      ...options,
      bubbles: [...options.bubbles, user("new", "streaming echo")],
      target: { ...options.target! },
    });
    rerender({ ...options, rangeNonce: 99 });
    rerender({ ...options, target: { ...options.target!, content_hash: "refreshed" } });
    expect(root.scrollTop).toBe(777);
    expect(scrollBy).toHaveBeenCalledOnce();
    expect(releaseScrollLock).toHaveBeenCalledOnce();
    expect(onResolved).toHaveBeenCalledOnce();
    rerender({ ...options, target: { ...options.target!, requestId: 2 } });
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it("pages existing older-history cursors, then mounts the exact stored item", async () => {
    root.innerHTML = markup("new", "newest");
    let loaded: Bubble[] = [user("new", "newest")];
    const loadMoreHistory = vi.fn(async () => {
      if (loadMoreHistory.mock.calls.length === 1) {
        useChatStore.setState({ oldestItemId: "middle" });
      } else {
        loaded = [user("old", "😀 echo echo"), ...loaded];
        useChatStore.setState({ oldestItemId: "old", hasMoreHistory: false });
      }
    });
    const ensure = vi.fn((id) => {
      expect(id).toBe("old");
      root.innerHTML = markup();
      return true;
    });
    useChatStore.setState({ oldestItemId: "new", hasMoreHistory: true, loadMoreHistory });
    const { rerender } = renderHook(() =>
      useChatSearchHighlights({ ...options, bubbles: loaded, ensureMessageVisible: ensure }),
    );
    await waitFor(() => expect(loadMoreHistory).toHaveBeenCalledTimes(2));
    rerender();
    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith({ target: options.target, status: "resolved" }),
    );
    expect(ensure).toHaveBeenCalledOnce();
    expect(scrollBy).toHaveBeenCalledOnce();
  });

  it("reports unavailable for a missing item or nonadvancing history cursor", async () => {
    const loadMoreHistory = vi.fn(async () => {});
    useChatStore.setState({ hasMoreHistory: true, loadMoreHistory });
    renderHook(() => useChatSearchHighlights({ ...options, bubbles: [] }));
    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith({ target: options.target, status: "unavailable" }),
    );
    expect(loadMoreHistory).toHaveBeenCalledOnce();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("rejects changed content even when the same snippet still exists", () => {
    renderHook(() =>
      useChatSearchHighlights({ ...options, bubbles: [user("old", "changed 😀 echo echo")] }),
    );
    expect(onResolved).toHaveBeenCalledWith({ target: options.target, status: "unavailable" });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges).toHaveLength(0);
  });

  it("clears the active highlight when its loaded source changes after resolution", () => {
    const { rerender } = renderHook((value) => useChatSearchHighlights(value), {
      initialProps: options,
    });
    rerender({ ...options, bubbles: [user("old", "changed 😀 echo echo")] });
    expect(onResolved).toHaveBeenLastCalledWith({ target: options.target, status: "unavailable" });
    expect(scrollBy).toHaveBeenCalledOnce();
    expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges).toHaveLength(0);
  });

  it("maps a bounded source window back to full UTF16 offsets after many emoji", () => {
    const text = "😀 ".repeat(12000) + "echo 😀 echo";
    const textStart = 30000;
    const start = text.lastIndexOf("echo");
    root.innerHTML = markup("old", text);
    renderHook(() =>
      useChatSearchHighlights({
        ...options,
        bubbles: [user("old", text)],
        target: {
          ...options.target!,
          sourceText: text.slice(textStart),
          textStart,
          range: { start: start - textStart, end: start - textStart + 4 },
        },
      }),
    );
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: "resolved" }));
    expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges[0].startOffset).toBe(start);
    expect(scrollBy).toHaveBeenCalledOnce();
  });

  it("rejects a stale bounded source window without using a surviving snippet", () => {
    renderHook(() =>
      useChatSearchHighlights({
        ...options,
        target: {
          ...options.target!,
          sourceText: "echo echo",
          textStart: 2,
          range: { start: 5, end: 9 },
        },
      }),
    );
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: "unavailable" }));
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it.each([
    { text: "😀 echo " + "padding ".repeat(1800) + "echo", query: "echo", textStart: 0 },
    {
      text: "😀".repeat(35000) + " Oldest reference needle✓ then needle✓.",
      query: "needle✓",
      textStart: 69916,
    },
  ])(
    "opens the actual collapsed prompt at source offset $textStart before selecting its older occurrence",
    async ({ text, query, textStart }) => {
      const bubble = user("old", text);
      const start = text.lastIndexOf(query);
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BubbleView bubble={bubble} />
        </QueryClientProvider>,
        { container: root },
      );
      expect(root.textContent).toContain("Show full prompt (");
      renderHook(() =>
        useChatSearchHighlights({
          ...options,
          query,
          bubbles: [bubble],
          target: {
            ...options.target!,
            sourceText: text.slice(textStart),
            textStart,
            range: { start: start - textStart, end: start - textStart + query.length },
          },
        }),
      );
      await waitFor(() =>
        expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: "resolved" })),
      );
      expect(root.textContent).toContain("Collapse prompt");
      expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges[0].toString()).toBe(query);
      expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges[0].startOffset).toBe(start);
      expect(highlights.get(CHAT_SEARCH_HIGHLIGHT)?.ranges).toHaveLength(2);
      expect(scrollBy).toHaveBeenCalledOnce();
      expect(root.querySelector("mark")).toBeNull();
    },
  );

  it("reports unavailable when an already resolved source disappears", () => {
    const { rerender } = renderHook((value) => useChatSearchHighlights(value), {
      initialProps: options,
    });
    rerender({ ...options, bubbles: [] });
    expect(onResolved).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unavailable" }));
    expect(scrollBy).toHaveBeenCalledOnce();
  });

  it("ignores another conversation and superseded history completions", async () => {
    let finish!: () => void;
    const loadMoreHistory = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    useChatStore.setState({ hasMoreHistory: true, loadMoreHistory });
    const { rerender } = renderHook((value) => useChatSearchHighlights(value), {
      initialProps: { ...options, bubbles: [] },
    });
    rerender({ ...options, conversationId: "other", bubbles: [] });
    await act(async () => {
      finish();
    });
    expect(onResolved).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("cleans up painting when search closes without moving the viewport", () => {
    const { rerender, unmount } = renderHook((value) => useChatSearchHighlights(value), {
      initialProps: options,
    });
    rerender({ ...options, target: null, query: "" });
    expect(highlights.get(CHAT_SEARCH_ACTIVE_HIGHLIGHT)?.ranges).toHaveLength(0);
    expect(scrollBy).toHaveBeenCalledOnce();
    unmount();
    expect(highlights.size).toBe(0);
  });
});
