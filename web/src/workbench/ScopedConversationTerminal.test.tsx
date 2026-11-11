import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTerminalFirst } from "@/shell/TerminalFirstContext";
import { WorkbenchProvider } from "./WorkbenchContext";
import { ScopedConversationTerminal } from "./ScopedConversationTerminal";

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    session: {
      harness: "codex-native",
      labels: { "omnigent.ui": "terminal", "omnigent.wrapper": "codex-native-ui" },
    },
  }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("keeps native behavior but opens the agent terminal as a separate dock view", () => {
  localStorage.setItem("omnigent:default-transcript-view", "terminal");
  const openView = vi.fn();
  function Probe() {
    const context = useTerminalFirst()!;
    return (
      <button
        type="button"
        onClick={() => context.setView("terminal")}
      >{`${context.view}:${context.isTerminalFirst}:${context.isNativeWrapper}`}</button>
    );
  }
  render(
    <WorkbenchProvider value={{ openView, openConversation: vi.fn() }}>
      <ScopedConversationTerminal conversationId="native-session">
        <Probe />
      </ScopedConversationTerminal>
    </WorkbenchProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "chat:false:true" }));
  expect(openView).toHaveBeenCalledWith({
    kind: "agent-terminal",
    conversationId: "native-session",
  });
});
