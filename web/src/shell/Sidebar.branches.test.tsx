import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarDataProvider } from "@/hooks/useSidebarData";
import { WorkbenchProvider } from "@/workbench/WorkbenchContext";
import { conversation, conversationPage } from "@/test/sidebarMockHelpers";
import type * as IdentityModule from "@/lib/identity";
import type { BranchConversation } from "@/lib/conversationBranches";
import { authenticatedFetch } from "@/lib/identity";
import { useConversations } from "@/hooks/useConversations";
import { Sidebar } from "./Sidebar";

vi.mock("@/hooks/useScopeCache", () => import("@/test/mockScopeCache"));
vi.mock("@/hooks/useConversations", async () => {
  const { conversationHooksMock } = await import("@/test/sidebarMockHelpers");
  return conversationHooksMock();
});
vi.mock("@/components/PermissionsModal", () => ({ PermissionsModal: () => null }));
vi.mock("@/lib/identity", async (original) => ({
  ...(await original<typeof IdentityModule>()),
  authenticatedFetch: vi.fn(),
}));
const branch = (id: string, parent?: string): BranchConversation => ({
  ...conversation(id),
  branch: parent
    ? { source_conversation_id: parent, reference_only: true, recovery: "replay" }
    : null,
});
const rows = [
  branch("root"),
  branch("one", "root"),
  branch("two", "one"),
  branch("three", "two"),
  branch("four", "three"),
];
beforeEach(() => {
  localStorage.clear();
  vi.mocked(useConversations).mockReturnValue(conversationPage([rows[0]]));
  vi.mocked(authenticatedFetch).mockImplementation(async (url) => {
    const parsed = new URL(String(url), "http://test");
    if (parsed.pathname === "/v1/sessions") {
      expect(parsed.searchParams.get("include_side_chats")).toBe("true");
      expect(parsed.searchParams.get("kind")).toBe("any");
      return new Response(JSON.stringify({ data: rows, has_more: false, last_id: "four" }));
    }
    const row = rows.find((item) => parsed.pathname === `/v1/sessions/${item.id}`);
    if (row) return new Response(JSON.stringify(row));
    return new Response("{}", { status: 404 });
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function renderTree(initial = "root") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [focusedConversationId, setFocused] = useState(initial);
    const actions = {
      focusedConversationId,
      openConversationIds: ["root", "two"],
      openConversation: setFocused,
      openView: vi.fn(),
    };
    return (
      <WorkbenchProvider value={actions}>
        <Sidebar workbench open onClose={vi.fn()} />
      </WorkbenchProvider>
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <SidebarDataProvider>
        <TooltipProvider>
          <MemoryRouter>
            <Harness />
          </MemoryRouter>
        </TooltipProvider>
      </SidebarDataProvider>
    </QueryClientProvider>,
  );
}
it("preserves the running spinner on a chat open elsewhere", async () => {
  vi.mocked(useConversations).mockReturnValue(
    conversationPage([{ ...rows[0], status: "running" }]),
  );
  renderTree("two");
  const spinner = await screen.findByRole("img", { name: "Session running" });
  expect(spinner.querySelector("svg")).not.toBeNull();
  expect(spinner.closest("[data-sidebar-session-id]")).toHaveAttribute(
    "data-open-elsewhere",
    "true",
  );
  expect(screen.queryByLabelText("Open elsewhere")).toBeNull();
});
it("preloads hierarchy, expands four levels, and retains navigation, menus and expansion on remount", async () => {
  const mounted = renderTree();
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "root" })).toHaveAttribute("aria-current", "page"),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Expand subchats of root" })).toBeInTheDocument(),
  );
  expect(
    vi
      .mocked(authenticatedFetch)
      .mock.calls.filter(([url]) => String(url).startsWith("/v1/sessions?")),
  ).toHaveLength(1);
  for (const id of ["root", "one", "two", "three"]) {
    // Each expansion reveals the next branch.
    // oxlint-disable-next-line no-await-in-loop
    fireEvent.click(await screen.findByRole("button", { name: `Expand subchats of ${id}` }));
  }
  const leaf = await screen.findByRole("link", { name: "four" });
  expect(leaf).toHaveClass("density-row", "density-tree-row");
  fireEvent.click(leaf);
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "four" })).toHaveAttribute("aria-current", "page"),
  );
  expect(screen.getByRole("link", { name: /two/ })).not.toHaveAttribute("aria-current");
  expect(screen.queryByLabelText("Open elsewhere")).not.toBeInTheDocument();
  expect(document.querySelectorAll('[data-open-elsewhere="true"]')).toHaveLength(2);
  const row = leaf.closest("[data-sidebar-session-id]")!;
  fireEvent.contextMenu(within(row as HTMLElement).getByRole("link"));
  expect(await screen.findByRole("menuitem", { name: /Rename/ })).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  mounted.unmount();
  renderTree("four");
  expect(await screen.findByRole("link", { name: "four" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Collapse subchats of one" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByRole("button", { name: "Collapse subchats of one" })).toHaveClass(
    "transition-none",
  );
});
it("never renders inaccessible ancestor titles and keeps an authorized orphan usable", async () => {
  const orphan = branch("authorized-orphan", "private-ancestor");
  vi.mocked(useConversations).mockReturnValue(conversationPage([orphan]));
  vi.mocked(authenticatedFetch).mockImplementation(async (url) => {
    if (String(url).includes("private-ancestor"))
      return new Response(JSON.stringify({ title: "secret ancestor" }), { status: 403 });
    return new Response(JSON.stringify({ data: [], has_more: false }));
  });
  renderTree("authorized-orphan");
  await waitFor(() =>
    expect(authenticatedFetch).toHaveBeenCalledWith("/v1/sessions/private-ancestor"),
  );
  expect(screen.queryByText("secret ancestor")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "authorized-orphan" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByText("private-ancestor")).not.toBeInTheDocument();
});
