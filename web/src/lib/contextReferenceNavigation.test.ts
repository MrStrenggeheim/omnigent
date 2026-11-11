import { expect, it, vi } from "vitest";
import { createQuoteSubchat } from "./contextReferenceNavigation";
import { forkSession } from "./sessionsApi";

vi.mock("./sessionsApi", () => ({ forkSession: vi.fn() }));
it("creates a durable branch at the captured item without any send or wake", async () => {
  vi.mocked(forkSession).mockResolvedValue({ id: "child" } as Awaited<
    ReturnType<typeof forkSession>
  >);
  expect(
    await createQuoteSubchat({ conversationId: "source", boundaryId: "captured", text: "quote" }),
  ).toBe("child");
  expect(forkSession).toHaveBeenCalledExactlyOnceWith("source", {
    title: "Subchat",
    upToItemId: "captured",
  });
  await expect(
    createQuoteSubchat({ conversationId: "source", boundaryId: "", text: "quote" }),
  ).rejects.toThrow("captured");
  expect(forkSession).toHaveBeenCalledTimes(1);
});
