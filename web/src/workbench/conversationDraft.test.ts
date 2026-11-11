import { afterEach, expect, it } from "vitest";
import { clearSessionDrafts, getSessionDraft, setSessionDraft } from "@/lib/sessionDrafts";
import { useChatStore } from "@/store/chatStore";
import { migrateConversationDraft } from "./conversationDraft";

afterEach(() => {
  clearSessionDrafts();
  useChatStore.setState({ sideChatComposers: {}, sideChatDrafts: {} });
});

it("keeps the existing primary draft and merges older side-pane quotes and files once", () => {
  const file = new File(["file"], "draft.txt");
  setSessionDraft("first", { text: "Primary draft", files: [file] });
  setSessionDraft("second", { text: "Other conversation", files: [] });
  useChatStore.getState().updateSideChatComposer("first", () => ({
    text: "Side draft",
    files: [file],
    quotes: [{ id: "quote", before: "Before quote", text: "Quoted text" }],
  }));
  migrateConversationDraft("first");
  const migrated = getSessionDraft("first");
  expect(migrated?.text).toBe("Primary draft\n\nBefore quote\n\n> Quoted text\n\nSide draft");
  expect(migrated?.replyDraft?.quotes).toEqual([
    { before: "Primary draft\n\nBefore quote", text: "Quoted text" },
  ]);
  expect(migrated?.files).toEqual([file]);
  expect(getSessionDraft("second")?.text).toBe("Other conversation");
  migrateConversationDraft("first");
  expect(getSessionDraft("first")).toBe(migrated);
});

it("preserves the existing primary draft unchanged when no side-pane migration is needed", () => {
  const primary = { text: "Unsent primary draft", files: [] };
  setSessionDraft("first", primary);
  migrateConversationDraft("first");
  expect(getSessionDraft("first")).toBe(primary);
});
