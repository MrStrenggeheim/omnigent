import { afterEach, expect, it, vi } from "vitest";
import { useChatStore } from "@/store/chatStore";
import { readReferenceDraft } from "./contextReferenceDrafts";
import type { ContextReference } from "./contextReferences";
import { insertQuoteReference, registerQuoteDestination } from "./quoteDraftDestinations";
import { serializeReplyDraft, snapshotReplyDraft, type ReplyDraft } from "./replyDraft";
import { clearSessionDrafts, getSessionDraft, setSessionDraft } from "./sessionDrafts";

const reference: ContextReference = {
  version: 1,
  snapshot_id: "snapshot",
  source_id: "source",
  source_title: "Source conversation",
  destination_id: null,
  scope: "quote",
  boundary_id: "selected-item",
  captured_at: 100,
  items: [{ id: "selected-item", response_id: "response", created_at: 99 }],
  quote: "First line\nSecond line",
  audience: "Visible to everyone with access to the destination",
  representation: "Exact stored items as JSON",
};

afterEach(() => {
  clearSessionDrafts();
  useChatStore.setState({ sideChatComposers: {}, sideChatDrafts: {} });
});

it.each(["stored", "side composer"])(
  "preserves %s reply cards, authored whitespace and attachments when inserting an attributed quote",
  (destination) => {
    const files = [new File(["keep"], "attachment.txt")];
    const draft: ReplyDraft = {
      quotes: [{ id: "existing", before: "Introduction", text: "Previous quote" }],
      text: "\nAnswer with > authored text\n\n",
    };
    setSessionDraft("target", {
      text: serializeReplyDraft(draft),
      replyDraft: snapshotReplyDraft(draft),
      files,
    });
    if (destination === "side composer") {
      useChatStore.getState().updateSideChatComposer("target", () => ({ ...draft, files }));
      setSessionDraft("target", { text: "Stale persisted draft", files: [] });
    }
    const send = vi.spyOn(useChatStore.getState(), "send");
    insertQuoteReference("target", reference);
    const next = getSessionDraft("target")!;
    expect(next.text).toBe(
      `${serializeReplyDraft(draft)}\n\n> First line\n> Second line\n\n[Open source](/c/source?message=selected-item)\n\n`,
    );
    expect(next.replyDraft?.quotes).toEqual(snapshotReplyDraft(draft)?.quotes);
    expect(next.files).toEqual(files);
    expect(useChatStore.getState().sideChatComposers.target.files).toEqual(files);
    expect(readReferenceDraft("target")).toEqual([reference]);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  },
);

it("delegates to a mounted composer so its current text, quote cards and files remain authoritative", () => {
  const insert = vi.fn();
  const unregister = registerQuoteDestination("target", insert);
  try {
    setSessionDraft("target", { text: "Stale stored draft", files: [] });
    insertQuoteReference("target", reference);
    expect(insert).toHaveBeenCalledExactlyOnceWith(
      "> First line\n> Second line\n\n[Open source](/c/source?message=selected-item)",
    );
    expect(getSessionDraft("target")?.text).toBe("Stale stored draft");
    expect(readReferenceDraft("target")).toEqual([reference]);
  } finally {
    unregister();
  }
});
