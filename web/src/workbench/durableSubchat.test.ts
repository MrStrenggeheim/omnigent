import { afterEach, expect, it, vi } from "vitest";
import { forkSession } from "@/lib/sessionsApi";
import { clearSessionDrafts, getSessionDraft } from "@/lib/sessionDrafts";
import type { Session } from "@/lib/types";
import { openDurableSubchat, subchatBoundary } from "./durableSubchat";

vi.mock("@/lib/sessionsApi", () => ({ forkSession: vi.fn() }));
afterEach(() => {
  clearSessionDrafts();
  vi.clearAllMocks();
});
it("forks at the captured boundary immediately, seeds before opening, and rejects duplicate in-flight actions", async () => {
  let finish!: (session: Session) => void;
  vi.mocked(forkSession).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const files = [new File(["notes"], "notes.txt")];
  const draft = { text: "question", files };
  const openConversation = vi.fn((id: string) =>
    expect(getSessionDraft(id)?.text).toBe("question"),
  );
  const request = { sourceId: "source", boundaryId: "captured-item", draft, openConversation };
  const first = openDurableSubchat(request);
  expect(forkSession).toHaveBeenCalledExactlyOnceWith("source", {
    title: "Subchat",
    upToItemId: "captured-item",
  });
  expect(openDurableSubchat(request)).toBeNull();
  draft.text = "newer source edit";
  files.length = 0;
  finish({ id: "child" } as Session);
  await first;
  expect(openConversation).toHaveBeenCalledExactlyOnceWith("child", { beside: true });
  expect(getSessionDraft("child")?.files).toHaveLength(1);
});
it("releases a failed request for retry without opening or seeding a child", async () => {
  vi.mocked(forkSession)
    .mockRejectedValueOnce(new Error("fork denied"))
    .mockResolvedValueOnce({ id: "retry-child" } as Session);
  const openConversation = vi.fn();
  const request = {
    sourceId: "retry-source",
    draft: { text: "keep", files: [] },
    openConversation,
  };
  await expect(openDurableSubchat(request)).rejects.toThrow("fork denied");
  expect(openConversation).not.toHaveBeenCalled();
  expect(getSessionDraft("retry-child")).toBeUndefined();
  await expect(openDurableSubchat(request)).resolves.toBe("retry-child");
});
it("captures the latest persisted source item, excluding live chunks and delegated items", () => {
  expect(
    subchatBoundary([
      { ctx: { depth: 0, itemId: "source-item" } },
      { ctx: { depth: 1, itemId: "delegated-item" } },
      { ctx: { depth: 0, itemId: null } },
    ]),
  ).toBe("source-item");
  expect(subchatBoundary([])).toBeUndefined();
});

it("never sends live previews or synthetic pending/history rows as a fork boundary", () => {
  const synthetic = [
    "live:message",
    "pending:message",
    "temp:message",
    "receipt:user",
    "tool:answer",
  ].map((itemId) => ({ ctx: { depth: 0, itemId } }));
  expect(subchatBoundary([{ ctx: { depth: 0, itemId: "committed-item" } }, ...synthetic])).toBe(
    "committed-item",
  );
  expect(subchatBoundary(synthetic)).toBeUndefined();
});
