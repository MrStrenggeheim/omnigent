import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useResizableColumn } from "./useResizableColumn";

function Column({ enabled = true }: { enabled?: boolean }) {
  const { width, containerRef, handleProps } = useResizableColumn(300, 180, 640, {
    preferenceKey: "explorerColumnWidthPx",
    label: "Resize Explorer",
    enabled,
  });
  return (
    <div ref={containerRef} data-testid="row">
      <output>{width}</output>
      <div {...handleProps} />
    </div>
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("anchors dragging to the container, persists at release and cleans the iframe shield", () => {
  render(<Column />);
  const row = screen.getByTestId("row");
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(400, 0, 1000, 600));
  const divider = screen.getByRole("separator");
  const count = document.body.childElementCount;
  fireEvent.mouseDown(divider, { button: 0 });
  expect(document.body.childElementCount).toBe(count + 1);
  fireEvent.mouseMove(window, { clientX: 850 });
  expect(divider).toHaveAttribute("aria-valuenow", "450");
  expect(localStorage.getItem("omnigent:panel-size-preferences")).toBeNull();
  fireEvent.mouseUp(window);
  expect(document.body.childElementCount).toBe(count);
  expect(document.body.style.cursor).toBe("");
  expect(
    JSON.parse(localStorage.getItem("omnigent:panel-size-preferences")!).explorerColumnWidthPx,
  ).toBe(450);
});

it("bounds keyboard resizing and restores body styles when a drag is interrupted", () => {
  const view = render(<Column />);
  const divider = screen.getByRole("separator");
  fireEvent.keyDown(divider, { key: "Home" });
  fireEvent.keyDown(divider, { key: "ArrowLeft" });
  expect(divider).toHaveAttribute("aria-valuenow", "180");
  fireEvent.keyDown(divider, { key: "End" });
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider).toHaveAttribute("aria-valuenow", "640");
  document.body.style.cursor = "crosshair";
  const count = document.body.childElementCount;
  fireEvent.mouseDown(divider, { button: 0 });
  view.rerender(<Column enabled={false} />);
  expect(document.body.childElementCount).toBe(count);
  expect(document.body.style.cursor).toBe("crosshair");
  document.body.style.cursor = "";
  act(() => window.dispatchEvent(new Event("blur")));
});
