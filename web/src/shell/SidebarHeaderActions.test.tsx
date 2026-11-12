import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { ALT_KEY, MOD_KEY } from "@/components/KeyboardShortcut";
import { TooltipProvider } from "@/components/ui/tooltip";

import { SidebarHeaderActions } from "./SidebarHeaderActions";
import { SidebarToggle } from "./SidebarToggle";

afterEach(cleanup);

describe("SidebarHeaderActions shortcut hints", () => {
  it.each([
    {
      control: "Search",
      tooltip: "Search",
      keys: [MOD_KEY, "K"],
      aria: MOD_KEY === "⌘" ? "Meta+K" : "Control+K",
    },
    {
      control: "Settings",
      tooltip: "Settings",
      keys: [MOD_KEY, ALT_KEY, ","],
      aria: MOD_KEY === "⌘" ? "Meta+Alt+," : "Control+Alt+,",
    },
    {
      control: "Close sidebar",
      tooltip: "Collapse sidebar",
      keys: [MOD_KEY, ALT_KEY, "["],
      aria: MOD_KEY === "⌘" ? "Meta+Alt+[" : "Control+Alt+[",
    },
  ])("shows the $control shortcut in its tooltip", async ({ control, tooltip, keys, aria }) => {
    render(
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>
          <SidebarHeaderActions expanded onToggle={vi.fn()} />
        </TooltipProvider>
      </MemoryRouter>,
    );

    const trigger = screen.getByLabelText(control);
    expect(trigger).toHaveAttribute("aria-keyshortcuts", aria);
    fireEvent.focus(trigger);
    const content = await screen.findByRole("tooltip");

    expect(content).toHaveTextContent(tooltip);
    expect(
      Array.from(content.querySelectorAll('[data-slot="kbd"]'), (key) => key.textContent),
    ).toEqual(keys);
  });
});

it("keeps Search reachable without duplicating the application-bar toggle", () => {
  const onOpenSearch = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarHeaderActions
          compact
          showToggle={false}
          expanded
          onToggle={vi.fn()}
          onOpenSearch={onOpenSearch}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
  expect(screen.queryByRole("button", { name: /sidebar/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(onOpenSearch).toHaveBeenCalledOnce();
});

it("omits the paused sidebar Search entry while retaining Settings", () => {
  const onOpenSearch = vi.fn();
  render(
    <MemoryRouter>
      <SidebarHeaderActions
        showSearch={false}
        expanded
        onToggle={vi.fn()}
        onOpenSearch={onOpenSearch}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  expect(onOpenSearch).not.toHaveBeenCalled();
});

it.each([false, true])(
  "keeps the shared toggle background transparent when expanded=%s",
  (expanded) => {
    render(<SidebarToggle side="left" expanded={expanded} aria-label="Navigation" />);
    const button = screen.getByRole("button", { name: "Navigation" });
    expect(button).toHaveClass("[&>[data-header-action-surface]]:bg-transparent!");
    expect(button.querySelector("svg")).toHaveAttribute("data-panel-filled", String(expanded));
    expect(button).toHaveAttribute("aria-expanded", String(expanded));
  },
);
