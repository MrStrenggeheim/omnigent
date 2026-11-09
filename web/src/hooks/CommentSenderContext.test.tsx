import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommentSenderProvider, useOptionalCommentSender } from "./CommentSenderContext";

const { fetchMock, sendMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), sendMock: vi.fn() }));
vi.mock("@/lib/identity", () => ({ authenticatedFetch: fetchMock }));
vi.mock("@/store/chatStore", () => ({ useChatStore: { getState: () => ({ send: sendMock }) } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps the draft DOM, focus and selection while agent availability and recipient change", async () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Draft() {
    const [draft, setDraft] = useState("");
    const sender = useOptionalCommentSender();
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <>
        <textarea
          aria-label="File draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          disabled={sender === null}
          onClick={() => sender?.mutate({ comment_ids: ["c3"] })}
        >
          Send comments
        </button>
      </>
    );
  }
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const tree = (sessionId: string, agentId: string | null) => (
    <QueryClientProvider client={queryClient}>
      <CommentSenderProvider sessionId={sessionId} agentId={agentId}>
        <Draft />
      </CommentSenderProvider>
    </QueryClientProvider>
  );
  const view = render(tree("conv_1", "ag_1"));
  const draft = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "File draft" });
  fireEvent.change(draft, { target: { value: "Unsaved file edit" } });
  draft.focus();
  draft.setSelectionRange(2, 9, "backward");
  for (const [sessionId, agentId] of [
    ["conv_2", null],
    ["conv_3", "ag_3"],
  ] as const) {
    view.rerender(tree(sessionId, agentId));
    expect(screen.getByRole("textbox", { name: "File draft" })).toBe(draft);
    expect(draft).toHaveValue("Unsaved file edit");
    expect(draft).toHaveFocus();
    expect([draft.selectionStart, draft.selectionEnd, draft.selectionDirection]).toEqual([
      2,
      9,
      "backward",
    ]);
    expect(screen.getByRole("button", { name: "Send comments" }).hasAttribute("disabled")).toBe(
      agentId === null,
    );
  }
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ formatted_message: "new chat comments", sent_comment_ids: ["c3"] }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Send comments" }));
  await waitFor(() =>
    expect(sendMock).toHaveBeenCalledWith("new chat comments", "ag_3", undefined, {
      pinnedConversationId: "conv_3",
    }),
  );
  expect(fetchMock.mock.calls[0][0]).toBe("/v1/sessions/conv_3/comments/send");
  expect(screen.getByRole("textbox", { name: "File draft" })).toBe(draft);
  expect(draft).toHaveFocus();
  view.unmount();
  expect(unmounted).toHaveBeenCalledTimes(1);
  queryClient.clear();
});
