import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabsScroller } from "./WorkspaceTabsScroller";

const resizeCallbacks = new Set<ResizeObserverCallback>();
let availableWidth = 300;
let tabsWidth = 300;

function Harness({ tabs = 1 }: { tabs?: number }) {
  const [overflow, setOverflow] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  return (
    <>
      <WorkspaceTabsScroller onOverflowChange={setOverflow} overflowControlRef={picker}>
        {Array.from({ length: tabs }, (_, index) => (
          <button type="button" key={index}>
            {index}
          </button>
        ))}
      </WorkspaceTabsScroller>
      {overflow && (
        <div ref={picker} data-testid="picker">
          Select panel
        </div>
      )}
    </>
  );
}

function setupGeometry() {
  availableWidth = 300;
  tabsWidth = 300;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.add(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-workspace-tabs-viewport")
      ? availableWidth - (screen.queryByTestId("picker") ? 28 : 0)
      : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-workspace-tabs-content") ||
      this.hasAttribute("data-workspace-tabs-viewport")
      ? tabsWidth
      : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.testid === "picker" ? 28 : 0;
  });
}

function resize(width: number) {
  availableWidth = width;
  act(() => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
  });
}

afterEach(() => {
  cleanup();
  resizeCallbacks.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WorkspaceTabsScroller", () => {
  it("shows overflow only when tabs cannot fit and releases the picker reservation on resize", () => {
    setupGeometry();
    render(<Harness />);
    expect(screen.queryByTestId("picker")).toBeNull();
    resize(299);
    expect(screen.getByTestId("picker")).toBeInTheDocument();
    resize(299);
    expect(screen.getByTestId("picker")).toBeInTheDocument();
    // Tabs fit if the picker is removed, but would still overflow if its width
    // remained reserved. Repeated observer delivery must settle with it hidden.
    resize(310);
    expect(screen.queryByTestId("picker")).toBeNull();
    resize(310);
    expect(screen.queryByTestId("picker")).toBeNull();
  });

  it("remeasures tab additions and removals without a window resize", () => {
    setupGeometry();
    const { rerender } = render(<Harness />);
    tabsWidth = 450;
    rerender(<Harness tabs={2} />);
    expect(screen.getByTestId("picker")).toBeInTheDocument();
    tabsWidth = 300;
    rerender(<Harness />);
    expect(screen.queryByTestId("picker")).toBeNull();
  });

  it("scrolls overflowing tabs with a vertical wheel while preserving horizontal gestures", () => {
    setupGeometry();
    tabsWidth = 450;
    const { container } = render(<Harness />);
    const viewport = container.querySelector<HTMLElement>("[data-workspace-tabs-viewport]")!;
    fireEvent.wheel(viewport, { deltaY: 30 });
    expect(viewport.scrollLeft).toBe(30);
    fireEvent.wheel(viewport, { deltaX: 20 });
    expect(viewport.scrollLeft).toBe(30);
    resize(500);
    fireEvent.wheel(viewport, { deltaY: 30 });
    expect(viewport.scrollLeft).toBe(30);
  });
});
