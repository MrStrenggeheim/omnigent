import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MobileWorkspaceButton,
  MobileWorkspaceProvider,
  MobileWorkspaceTabs,
  type MobileWorkspaceTab,
} from "./MobileWorkspace";

const { isMobileMock } = vi.hoisted(() => ({ isMobileMock: vi.fn(() => true) }));

vi.mock("@/hooks/useIsMobileViewport", () => ({
  useIsMobileViewport: () => isMobileMock(),
}));

const availableTabs: Omit<MobileWorkspaceTab, "open">[] = [
  { id: "files", label: "Files", icon: null },
  { id: "changes", label: "Changes", icon: null, badge: 3 },
  { id: "search", label: "Search", icon: null },
  { id: "shells", label: "Shells", icon: null, badge: 2 },
  { id: "agents", label: "Agents", icon: null, badge: "1/4" },
  { id: "github", label: "Pull Requests", icon: null },
  { id: "sidechats", label: "Side chats", icon: null },
  { id: "logs", label: "Logs", icon: null },
];

// Panel switches remount tabs in the destination drawer; the provider stays mounted.
function WorkspaceHarness({
  sessionId = "session-1",
  tabs = availableTabs,
  initialActive = null,
  onOpen,
  beforeNavigate,
}: {
  sessionId?: string;
  tabs?: typeof availableTabs;
  initialActive?: string | null;
  onOpen?: (id: string) => void;
  beforeNavigate?: (navigate: () => void) => void;
}) {
  const [active, setActive] = useState(initialActive);
  return (
    <MobileWorkspaceProvider
      sessionId={sessionId}
      active={active}
      overlayToggle={!beforeNavigate || !active}
      onClose={() => setActive(null)}
      tabs={tabs.map((tab) => ({
        ...tab,
        open: () => {
          onOpen?.(tab.id);
          setActive(tab.id);
        },
      }))}
    >
      <MobileWorkspaceButton />
      <MobileWorkspaceTabs key={active} beforeNavigate={beforeNavigate} />
      <button type="button" onClick={() => setActive(null)}>
        Dismiss workspace
      </button>
    </MobileWorkspaceProvider>
  );
}

afterEach(() => {
  cleanup();
  isMobileMock.mockReturnValue(true);
});

describe("MobileWorkspace", () => {
  it.each([false, true])(
    "guards the file overlay close before leaving the workspace (confirm=%s)",
    (confirm) => {
      let pending: (() => void) | undefined;
      const guard = vi.fn((close: () => void) => {
        pending = close;
      });
      render(<WorkspaceHarness initialActive="files" beforeNavigate={guard} />);
      const close = screen.getByRole("button", { name: "Close workspace" });
      fireEvent.click(close);
      expect(guard).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
      if (confirm) {
        act(() => pending?.());
        expect(screen.queryByRole("tablist")).toBeNull();
        expect(screen.getByRole("button", { name: "Open workspace" })).toBeInTheDocument();
      } else {
        expect(screen.getByRole("button", { name: "Close workspace" })).toBe(close);
      }
    },
  );

  it("removes the portal on desktop resize and restores the selected panel on mobile", () => {
    const { rerender } = render(<WorkspaceHarness initialActive="changes" />);
    expect(screen.getByRole("button", { name: "Close workspace" })).toHaveClass("fixed");
    isMobileMock.mockReturnValue(false);
    rerender(<WorkspaceHarness initialActive="changes" />);
    expect(document.querySelector("[data-workspace-overlay-toggle]")).toBeNull();
    isMobileMock.mockReturnValue(true);
    rerender(<WorkspaceHarness initialActive="changes" />);
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll("[data-workspace-overlay-toggle]")).toHaveLength(1);
  });

  it("omits controls without a provider", () => {
    render(
      <>
        <MobileWorkspaceButton />
        <MobileWorkspaceTabs />
      </>,
    );

    expect(screen.queryByRole("button", { name: "Open workspace" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("omits controls when no tabs are available", () => {
    render(<WorkspaceHarness tabs={[]} initialActive="files" />);

    expect(screen.queryByRole("button", { name: "Open workspace" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("opens the first available panel and focuses its tab", async () => {
    const onOpen = vi.fn();
    render(<WorkspaceHarness onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "Open workspace" });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("files");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Files" })).toHaveFocus());
  });

  it("keeps one viewport close toggle above drawers while tabs switch and closes on a second tap", () => {
    const { container } = render(<WorkspaceHarness initialActive="files" />);
    const close = screen.getByRole("button", { name: "Close workspace" });
    const coordinate = { top: close.style.top, right: close.style.right };
    expect(container.contains(close)).toBe(false);
    expect(close.parentElement).toBe(document.body);
    expect(close).toHaveClass("fixed", "z-[60]", "size-6", "max-md:size-11");
    expect(close.style.top).toContain("--omnigent-safe-top");
    expect(close.style.right).toContain("--omnigent-safe-right");
    expect(close.querySelector("svg")).toHaveAttribute("data-panel-side", "right");
    expect(close.querySelector("svg")).toHaveAttribute("data-panel-filled", "true");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes" }), { button: 0 });
    expect(screen.getByRole("button", { name: "Close workspace" })).toBe(close);
    fireEvent.click(close);
    expect(screen.queryByRole("tablist")).toBeNull();
    const opener = screen.getByRole("button", { name: "Open workspace" });
    expect(opener).toBe(close);
    expect({ top: opener.style.top, right: opener.style.right }).toEqual(coordinate);
    expect(opener).toHaveAttribute("aria-expanded", "false");
  });

  it("renders supplied tabs in order with badges and existing pill styles", () => {
    render(<WorkspaceHarness initialActive="files" />);

    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual(
      availableTabs.map((tab) => tab.label),
    );
    expect(screen.getByRole("tablist", { name: "Workspace" })).toHaveAttribute(
      "data-variant",
      "pill",
    );
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: "Shells" })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveTextContent("1/4");
    for (const tab of screen.getAllByRole("tab")) expect(tab).toHaveClass("min-h-11");
  });

  it("shows only the supplied available tabs", () => {
    render(<WorkspaceHarness tabs={[availableTabs[3], availableTabs[6]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Shells",
      "Side chats",
    ]);
    expect(screen.getByRole("tab", { name: "Shells" })).toHaveAttribute("aria-selected", "true");
  });

  it("omits tabs on desktop even when a panel is active", () => {
    isMobileMock.mockReturnValue(false);
    render(<WorkspaceHarness initialActive="files" />);

    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it.each(availableTabs.slice(1))(
    "navigates to $label through its drawer callback",
    async ({ id, label }) => {
      const onOpen = vi.fn();
      render(<WorkspaceHarness initialActive="files" onOpen={onOpen} />);
      const tab = screen.getByRole("tab", { name: label });

      fireEvent.mouseDown(tab, { button: 0 });

      expect(onOpen).toHaveBeenCalledWith(id);
      expect(onOpen.mock.calls.every(([opened]) => opened === id)).toBe(true);
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
      await waitFor(() => expect(screen.getByRole("tab", { name: label })).toHaveFocus());
      expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "false");
    },
  );

  it("remembers the selected panel and restores tab focus after closing and reopening", async () => {
    const onOpen = vi.fn();
    render(<WorkspaceHarness initialActive="files" onOpen={onOpen} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes" }), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss workspace" }));

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "Open workspace" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    onOpen.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("changes");
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Changes" })).toHaveFocus());
  });

  it("remembers a panel opened externally by the shell", () => {
    const onOpen = vi.fn();
    render(<WorkspaceHarness initialActive="logs" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("logs");
    expect(screen.getByRole("tab", { name: "Logs" })).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to the first available panel if the remembered tab disappears", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<WorkspaceHarness initialActive="sidechats" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss workspace" }));
    rerender(<WorkspaceHarness tabs={availableTabs.slice(0, 2)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("files");
    expect(screen.queryByRole("tab", { name: "Side chats" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
  });

  it("resets the remembered selection when switching sessions without remounting", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<WorkspaceHarness onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes" }), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss workspace" }));
    rerender(<WorkspaceHarness sessionId="session-2" onOpen={onOpen} />);
    onOpen.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("files");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
  });

  it.each([false, true])("defers guarded navigation until confirmed (confirm=%s)", (confirm) => {
    let pendingNavigation: (() => void) | undefined;
    const beforeNavigate = vi.fn((navigate: () => void) => {
      pendingNavigation = navigate;
    });
    const onOpen = vi.fn();
    render(
      <WorkspaceHarness initialActive="files" beforeNavigate={beforeNavigate} onOpen={onOpen} />,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes" }), { button: 0 });

    expect(beforeNavigate).toHaveBeenCalled();
    expect(pendingNavigation).toBeTypeOf("function");
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "false");

    if (confirm) {
      act(() => pendingNavigation?.());
      expect(onOpen).toHaveBeenCalledExactlyOnceWith("changes");
      expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    } else {
      pendingNavigation = undefined;
      fireEvent.click(screen.getByRole("button", { name: "Dismiss workspace" }));
      fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));
      expect(onOpen).toHaveBeenCalledExactlyOnceWith("files");
      expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    }
  });

  it("moves keyboard focus and selection through the available tabs with arrow keys", async () => {
    const onOpen = vi.fn();
    render(<WorkspaceHarness tabs={availableTabs.slice(0, 2)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));
    const files = screen.getByRole("tab", { name: "Files" });

    fireEvent.keyDown(files, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Changes" })).toHaveFocus());
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    expect(onOpen).toHaveBeenLastCalledWith("changes");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Changes" }), { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Files" })).toHaveFocus());
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(onOpen).toHaveBeenLastCalledWith("files");
  });
});
