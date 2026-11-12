import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useTerminalFirst } from "@/shell/TerminalFirstContext";
import { ViewModeToggle } from "@/shell/ViewModeToggle";
import { ScopedConversationTerminal } from "./ScopedConversationTerminal";

vi.mock("@/hooks/useSession", () => ({
  useSession: (id: string) => ({
    session: { id, labels: id === "native" ? { "omnigent.ui": "terminal" } : {} },
  }),
}));
vi.mock("@/hooks/useTerminals", () => ({
  useTerminals: () => ({ terminals: [] }),
  findAgentTerminal: () => null,
}));

function Surface() {
  const context = useTerminalFirst();
  return (
    <>
      <ViewModeToggle alwaysVisible />
      <p>{context?.view} surface</p>
    </>
  );
}

describe("scoped chat view selection", () => {
  it("lets the shared header control select Terminal and return to Chat even before a terminal exists", async () => {
    const user = userEvent.setup();
    render(
      <ScopedConversationTerminal conversationId="native">
        <Surface />
      </ScopedConversationTerminal>,
    );
    await user.click(screen.getByTestId("view-mode-terminal"));
    expect(screen.getByText("terminal surface")).toBeVisible();
    await user.click(screen.getByTestId("view-mode-chat"));
    expect(screen.getByText("chat surface")).toBeVisible();
  });
  it("keeps the existing terminal-capability gate for non-terminal chats", () => {
    render(
      <ScopedConversationTerminal conversationId="sdk">
        <Surface />
      </ScopedConversationTerminal>,
    );
    expect(screen.queryByTestId("view-mode-toggle")).not.toBeInTheDocument();
  });
});
