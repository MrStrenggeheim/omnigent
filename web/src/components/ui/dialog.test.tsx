import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "./dialog";

// The iOS shell keeps the WKWebView layout viewport full-height when the soft
// keyboard opens, so a modal capped at `85vh` and centered on `50%` would sit
// partly behind the keyboard. DialogContent pins its height cap and centering
// origin to the keyboard-aware `--omnigent-viewport-height` — but only inside
// the iOS shell. These tests pin that gating.

function setIOS(on: boolean): void {
  if (on) {
    (window as unknown as Record<string, unknown>).omnigentNative = { kind: "ios" };
  } else {
    delete (window as unknown as Record<string, unknown>).omnigentNative;
  }
}

afterEach(() => {
  cleanup();
  setIOS(false);
});

function renderDialog() {
  return render(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogTitle>Test</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
}

describe("DialogContent keyboard-aware sizing", () => {
  it("caps height and centering to the visible viewport inside the iOS shell", () => {
    setIOS(true);
    renderDialog();
    const content = screen.getByRole("dialog");
    // Inline style (not a class) so it wins over any caller's max-h-[85vh].
    expect(content.style.maxHeight).toContain("--omnigent-viewport-height");
    expect(content.style.top).toContain("--omnigent-viewport-height");
  });

  it("applies no viewport inline style off the iOS shell", () => {
    setIOS(false);
    renderDialog();
    const content = screen.getByRole("dialog");
    expect(content.style.maxHeight).toBe("");
    expect(content.style.top).toBe("");
  });
});

describe("DialogContent column sizing", () => {
  it("uses a single zero-minimum column so unbreakable content cannot widen the panel", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toHaveClass("grid-cols-[minmax(0,1fr)]");
  });
});

it("keeps Close accessible and functional without redundant hover or keyboard guidance", async () => {
  const onOpenChange = vi.fn();
  render(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Tools</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  const close = screen.getByRole("button", { name: "Close" });
  await userEvent.hover(close);
  expect(close).not.toHaveAttribute("data-slot", "tooltip-trigger");
  expect(close).not.toHaveAttribute("title");
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.keyDown(document, { key: "Tab" });
  fireEvent.focus(close);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(close);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
