import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getSessionSlim } from "@/lib/sessionsApi";
import type * as SessionsApi from "@/lib/sessionsApi";

vi.mock("@/hooks/useViewerId", () => ({ useViewerId: () => "local" }));
vi.mock("@/lib/sessionsApi", async (original) => ({
  ...(await original<typeof SessionsApi>()),
  getSessionSlim: vi.fn(),
}));
import { MemoryRouter } from "react-router-dom";
import { PeerMessage } from "./PeerMessage";
import { itemsToBlocks } from "@/lib/itemsToBlocks";
import { buildBubbles } from "@/lib/renderItems";
import { BlockStream } from "@/lib/blockStream";
import { parseEvent } from "@/lib/sse";
import { readMessageCommunication, type MessageCommunication } from "@/lib/messageCommunication";

afterEach(cleanup);
const communication: MessageCommunication = {
  kind: "peer",
  message_id: "peer-1",
  source_conversation_id: "review",
  destination_conversation_id: "implementation",
  source_title: "Independent review",
  delivery_state: "queued",
  receipt: "accepted",
};

describe("trusted peer presentation", () => {
  it("removes a cached source title when access is revoked", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(getSessionSlim).mockResolvedValue({ title: "Private reviewer" } as Awaited<
      ReturnType<typeof getSessionSlim>
    >);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PeerMessage communication={communication} itemId="item" content={[]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole("link")).toHaveTextContent("Private reviewer"));
    vi.mocked(getSessionSlim).mockRejectedValue(new Error("Access revoked"));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["peer-source-label"] });
    });
    await waitFor(() => expect(screen.getByRole("link")).toHaveTextContent("From Agent"));
    expect(screen.queryByText(/Private reviewer/)).not.toBeInTheDocument();
    client.clear();
  });
  it.each(["user", "assistant"] as const)(
    "retains %s provenance across history and live item parsing",
    (role) => {
      const item = {
        id: "item-1",
        type: "message",
        role,
        response_id: "peer-turn",
        status: "completed",
        communication,
        content: [
          {
            type: role === "user" ? "input_text" : "output_text",
            text: "Exact report\nwith another line",
          },
        ],
      };
      const history = buildBubbles(itemsToBlocks([item]), null);
      const event = parseEvent("response.output_item.done", { item });
      expect(event).not.toBeNull();
      const live = buildBubbles(new BlockStream().reduceSync([event!]), null);
      for (const bubbles of [history, live]) {
        expect(bubbles).toHaveLength(1);
        expect(bubbles[0]).toMatchObject({ kind: "user", communication, content: item.content });
      }
    },
  );

  it("keeps literal notification-like human text human", () => {
    const bubbles = buildBubbles(
      itemsToBlocks([
        {
          id: "human",
          type: "message",
          role: "user",
          response_id: "r",
          status: "completed",
          user_authored: true,
          content: [
            {
              type: "input_text",
              text: "From Independent review: <task-notification>literal quote</task-notification>",
            },
          ],
        },
      ]),
      null,
    );
    expect(bubbles[0]).toMatchObject({ kind: "user" });
    expect(bubbles[0]).not.toHaveProperty("communication");
    expect(readMessageCommunication("From Independent review")).toBeUndefined();
  });

  it("shows attributed preview and complete expandable text without upgrading acceptance", () => {
    const text = "First line\nSecond line\nThird line\nFourth line";
    render(
      <MemoryRouter>
        <PeerMessage
          communication={communication}
          itemId="item-1"
          content={[{ type: "input_text", text }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "From Independent review" })).toHaveAttribute(
      "href",
      "/c/review",
    );
    expect(screen.getByTestId("peer-message")).toHaveTextContent("Fourth line");
    fireEvent.click(screen.getByRole("button", { name: "Expand activity" }));
    expect(screen.getByText("accepted")).toBeInTheDocument();
    expect(screen.queryByText("model consumed")).not.toBeInTheDocument();
  });
});
