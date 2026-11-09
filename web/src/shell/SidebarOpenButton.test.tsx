import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarOpenButton } from "./SidebarOpenButton";
import { SidebarToggle } from "./SidebarToggle";

vi.mock("@/hooks/useIsMobileViewport", () => ({ useIsMobileViewport: () => true }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SidebarOpenButton", () => {
  it.each(["icon-xs", "icon-sm"] as const)(
    "uses the left panel outline with a 44px mobile target (%s)",
    (size) => {
      const open = vi.fn();
      render(
        <TooltipProvider>
          <SidebarOpenButton onOpenSidebar={open} componentId="test.sidebar" size={size} />
        </TooltipProvider>,
      );
      const button = screen.getByRole("button", { name: "Open sidebar" });
      expect(button).toHaveClass("max-md:size-11");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button.querySelector("svg")).toHaveAttribute("data-panel-side", "left");
      expect(button.querySelector("svg")).toHaveAttribute("data-panel-filled", "false");
      fireEvent.click(button);
      expect(open).toHaveBeenCalledExactlyOnceWith(false);
    },
  );

  it("does not trigger a desktop hover preview from mobile pointer events", () => {
    vi.useFakeTimers();
    const open = vi.fn();
    render(
      <TooltipProvider>
        <SidebarOpenButton onOpenSidebar={open} componentId="test.sidebar" />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Open sidebar" });
    fireEvent.pointerEnter(button);
    act(() => vi.advanceTimersByTime(500));
    expect(open).not.toHaveBeenCalled();
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("fills the same narrow left segment while expanded", () => {
    const { rerender } = render(
      <SidebarToggle side="left" expanded={false} aria-label="Toggle sidebar" />,
    );
    const button = screen.getByRole("button", { name: "Toggle sidebar" });
    const outline = button.querySelector("rect")?.outerHTML;
    rerender(<SidebarToggle side="left" expanded aria-label="Toggle sidebar" />);
    expect(button.querySelector("rect")?.outerHTML).toBe(outline);
    expect(button.querySelector("svg")).toHaveAttribute("data-panel-filled", "true");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});
