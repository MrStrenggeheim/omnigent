import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/store/chatStore";
import { conversationRegistry } from "@/store/conversationRegistry";
import * as sessionsApi from "@/lib/sessionsApi";
import type { Session } from "@/lib/types";
import {
  createScopedChatStore,
  ScopedChatStoreProvider,
  useConversationChatStore,
} from "./ScopedChatStore";

const originalActions = useChatStore.getState();

beforeEach(() => {
  conversationRegistry.clear();
  useChatStore.setState({ ...originalActions, conversationId: "primary" });
});

afterEach(() => {
  cleanup();
  conversationRegistry.clear();
  vi.restoreAllMocks();
});

describe("scoped chat store", () => {
  it("settles a model change on its original conversation after primary focus changes", async () => {
    let finish!: (session: Session) => void;
    const update = vi.spyOn(sessionsApi, "updateSession").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = conversationRegistry.acquire("first");
    const store = createScopedChatStore("first");
    const change = store.getState().setModel("new-model");
    expect(first.getState().sessionModelOverride).toBe("new-model");
    useChatStore.setState({ conversationId: "second", sessionModelOverride: "second-model" });
    finish({ id: "first", modelOverride: "canonical-model" } as Session);
    await change;
    expect(update).toHaveBeenCalledWith("first", { modelOverride: "new-model" });
    expect(first.getState().sessionModelOverride).toBe("canonical-model");
    expect(useChatStore.getState().sessionModelOverride).toBe("second-model");
  });

  it("keeps attachments and navigation flashes local to each mounted composer", () => {
    conversationRegistry.acquire("first");
    conversationRegistry.acquire("second");
    const first = createScopedChatStore("first");
    const second = createScopedChatStore("second");
    first.getState().addComposerAttachment({ path: "first.txt", isDir: false });
    first.getState().flashUserMessage("first-message");
    expect(first.getState().pendingComposerAttachments).toHaveLength(1);
    expect(second.getState().pendingComposerAttachments).toEqual([]);
    expect(second.getState().flashItemId).toBeNull();
    expect(useChatStore.getState().pendingComposerAttachments).toEqual([]);
    first.getState().clearPendingComposerAttachments();
    expect(first.getState().pendingComposerAttachments).toEqual([]);
  });

  it("projects two live entries without switching the primary store", () => {
    const first = conversationRegistry.acquire("first");
    const second = conversationRegistry.acquire("second");
    first.setState({ sessionModelOverride: "model-one" });
    second.setState({ sessionModelOverride: "model-two" });
    function Model() {
      const useStore = useConversationChatStore();
      const id = useStore((s) => s.conversationId);
      const model = useStore((s) => s.sessionModelOverride);
      return <div data-testid={id!}>{model}</div>;
    }
    render(
      <>
        <ScopedChatStoreProvider conversationId="first" focused>
          <Model />
        </ScopedChatStoreProvider>
        <ScopedChatStoreProvider conversationId="second" focused={false}>
          <Model />
        </ScopedChatStoreProvider>
      </>,
    );
    expect(screen.getByTestId("first")).toHaveTextContent("model-one");
    expect(screen.getByTestId("second")).toHaveTextContent("model-two");
    act(() => second.setState({ sessionModelOverride: "model-three" }));
    expect(screen.getByTestId("first")).toHaveTextContent("model-one");
    expect(screen.getByTestId("second")).toHaveTextContent("model-three");
    expect(useChatStore.getState().conversationId).toBe("primary");
  });

  it("pins sends, skills, queues, approvals and history to the originating pane", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sendSlashCommand = vi.fn().mockResolvedValue(undefined);
    const enqueueMessage = vi.fn();
    const submitApproval = vi.fn().mockResolvedValue(undefined);
    const loadMoreHistory = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      send,
      sendSlashCommand,
      enqueueMessage,
      submitApproval,
      loadMoreHistory,
    });
    const first = createScopedChatStore("first");
    const { send: sendFirst, sendSlashCommand: skillFirst } = first.getState();
    useChatStore.setState({ conversationId: "second" });
    await sendFirst("first prompt", "agent", [], { pinnedConversationId: "wrong" });
    await skillFirst("review", "this", "agent");
    first.getState().enqueueMessage("later");
    await first.getState().submitApproval("approval", "accept");
    await first.getState().loadMoreHistory();
    expect(send).toHaveBeenCalledWith("first prompt", "agent", [], {
      pinnedConversationId: "first",
    });
    expect(sendSlashCommand).toHaveBeenCalledWith("review", "this", "agent", {
      pinnedConversationId: "first",
    });
    expect(enqueueMessage).toHaveBeenCalledWith("later", undefined, undefined, "first");
    expect(submitApproval).toHaveBeenCalledWith(
      "approval",
      "accept",
      undefined,
      undefined,
      "first",
    );
    expect(loadMoreHistory).toHaveBeenCalledWith("first");
    expect(useChatStore.getState().conversationId).toBe("second");
  });

  it("routes updates to the entry and preserves global queue state", () => {
    const entry = conversationRegistry.acquire("first");
    const store = createScopedChatStore("first");
    expect(store.getState()).toBe(store.getState());
    store.setState({ sessionReasoningEffort: "high" });
    expect(entry.getState().sessionReasoningEffort).toBe("high");
    expect(useChatStore.getState().sessionReasoningEffort).toBeNull();
    expect(() => store.setState({ conversationId: "second" })).toThrow("cannot change");
    expect(store.getState().conversationId).toBe("first");
  });
});
