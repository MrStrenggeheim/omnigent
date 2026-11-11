import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationView } from "./ConversationView";

vi.mock("./ScopedConversationSurface", () => ({ ScopedConversationSurface: () => null }));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    session: {
      id: "chat",
      title: "Chat A",
      status: "idle",
      labels: {},
      createdAt: 1,
      permissionLevel: 4,
      agentId: "agent",
      workspace: "/project",
      parentSessionId: null,
    },
  }),
}));
vi.mock("@/hooks/useAgents", () => ({ useSessionAgent: () => ({ data: undefined }) }));
vi.mock("@/hooks/usePermissions", () => ({ useCanEdit: () => true }));
vi.mock("@/hooks/useSessionActionRestrictions", () => ({
  useSessionActionRestrictions: () => ({}),
}));
vi.mock("@/hooks/RunnerHealthProvider", () => ({ useRunnerHealthRegistration: () => {} }));
vi.mock("@/hooks/useBrowserAgentRelay", () => ({ useBrowserAgentRelay: () => {} }));
vi.mock("@/hooks/useUiOpenFile", () => ({ useUiOpenFile: () => {} }));
vi.mock("@/shell/useWorkspaceResources", () => ({
  useWorkspaceResources: () => ({ showFilesPanel: false }),
}));
vi.mock("@/shell/ContextSearchContext", () => ({ useContextSearch: () => null }));
vi.mock("@/shell/HeaderConversationMenu", () => ({
  HeaderConversationMenu: ({ onShare }: { onShare: () => void }) => (
    <button type="button" onClick={onShare}>
      Share
    </button>
  ),
}));
vi.mock("@/components/PermissionsModal", () => ({
  PermissionsModal: ({ open }: { open: boolean }) => (open ? <div>Sharing dialog</div> : null),
}));
vi.mock("./viewCommands", () => ({ useViewCommands: () => {} }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

it("moves only the header into dock chrome and back without remounting the chat", () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Draft() {
    const [text, setText] = useState("");
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <textarea aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />
    );
  }
  const firstTarget = document.createElement("div");
  const secondTarget = document.createElement("div");
  document.body.append(firstTarget, secondTarget);
  const view = (headerTarget?: HTMLElement | null) => (
    <ConversationView conversationId="chat" focused headerTarget={headerTarget}>
      <Draft />
    </ConversationView>
  );
  const { container, rerender, unmount } = render(view());
  const input = screen.getByRole("textbox", { name: "Draft" });
  fireEvent.change(input, { target: { value: "Unsent message" } });
  expect(
    within(container).getByRole("navigation", { name: "Conversation ancestry" }),
  ).toHaveTextContent("Chat A");

  rerender(view(firstTarget));
  expect(
    within(firstTarget).getByRole("navigation", { name: "Conversation ancestry" }),
  ).toHaveTextContent("Chat A");
  expect(within(container).queryByRole("navigation", { name: "Conversation ancestry" })).toBeNull();
  fireEvent.click(within(firstTarget).getByRole("button", { name: "Share" }));
  expect(screen.getByText("Sharing dialog")).toBeInTheDocument();

  rerender(view(secondTarget));
  expect(firstTarget).toBeEmptyDOMElement();
  expect(
    within(secondTarget).getByRole("navigation", { name: "Conversation ancestry" }),
  ).toBeInTheDocument();
  rerender(view(null));
  expect(secondTarget).toBeEmptyDOMElement();
  expect(
    within(container).getByRole("navigation", { name: "Conversation ancestry" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  expect(input).toHaveValue("Unsent message");
  expect(mounted).toHaveBeenCalledOnce();
  expect(unmounted).not.toHaveBeenCalled();
  unmount();
  expect(unmounted).toHaveBeenCalledOnce();
});
