import { createRef } from "react";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { setEmbedRoot } from "@/lib/host";
import { SelectionPopup } from "./SelectionPopup";

afterEach(() => {
  cleanup();
  setEmbedRoot(null);
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

it.each([true, false])("portals outside the transcript (embedded: %s)", (embedded) => {
  const containerRef = createRef<HTMLDivElement>();
  const onReply = vi.fn();
  const { container } = render(
    <>
      <div ref={containerRef}>Selected message</div>
      <SelectionPopup containerRef={containerRef} onReply={onReply} />
    </>,
  );
  if (embedded) setEmbedRoot(container);

  const range = document.createRange();
  range.selectNodeContents(containerRef.current!);
  range.getBoundingClientRect = () => new DOMRect(10, 30, 80, 20);
  range.getClientRects = () => [] as unknown as DOMRectList;
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event("selectionchange"));

  const reply = screen.getByRole("menuitem", { name: "Reply ↵" });
  expect(reply.parentElement?.parentElement).toBe(embedded ? container : document.body);
  expect(reply.parentElement).toHaveClass("fixed");
  expect(reply.parentElement).toHaveStyle({ left: "10px", top: "24px" });
  fireEvent.click(reply);
  expect(onReply).toHaveBeenCalledExactlyOnceWith("Selected message");
  expect(screen.queryByRole("menuitem", { name: "Reply ↵" })).toBeNull();
});

function selectMessage(onAskInSideChat?: (text: string) => void) {
  const containerRef = createRef<HTMLDivElement>();
  const onReply = vi.fn();
  render(
    <>
      <div ref={containerRef}>Selected message</div>
      <div data-testid="composer">Composer text</div>
      <SelectionPopup
        containerRef={containerRef}
        onReply={onReply}
        onAskInSideChat={onAskInSideChat}
      />
    </>,
  );
  const range = document.createRange();
  range.selectNodeContents(containerRef.current!);
  range.getBoundingClientRect = () => new DOMRect(10, 200, 500, 80);
  range.getClientRects = () => [new DOMRect(30, 200, 80, 20)] as unknown as DOMRectList;
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  return { onReply, range };
}

it.each(["mouse", "touch"])(
  "preserves the selection during %s activation and asks in side chat once",
  (pointerType) => {
    const onAsk = vi.fn();
    const { onReply } = selectMessage(onAsk);
    const ask = screen.getByRole("menuitem", { name: "Ask in side chat" });
    const menu = screen.getByRole("menu", { name: "Selected text" });
    expect(menu.className).toContain("shadow-menu");
    expect(menu.style.left).toBe("30px");
    expect(menu.style.top).toBe("194px");
    const press = createEvent.pointerDown(ask, { cancelable: true });
    Object.defineProperty(press, "pointerType", { value: pointerType });
    fireEvent(ask, press);
    expect(press.defaultPrevented).toBe(true);
    expect(fireEvent.mouseDown(ask)).toBe(false);
    expect(window.getSelection()?.toString()).toBe("Selected message");
    fireEvent.click(ask);
    expect(onAsk).toHaveBeenCalledExactlyOnceWith("Selected message");
    expect(onReply).not.toHaveBeenCalled();
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  },
);

it("uses keyboard menu navigation and keeps the selected quote after focus moves", async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn();
  selectMessage(onAsk);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Reply ↵" }));
  await user.keyboard("{ArrowRight}");
  fireEvent(document, new Event("selectionchange"));
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Ask in side chat" }));
  await user.keyboard("{Enter}");
  expect(onAsk).toHaveBeenCalledExactlyOnceWith("Selected message");
});

it("dismisses on Escape or an outside press and hides unsupported side chat", () => {
  const { onReply } = selectMessage();
  expect(screen.queryByRole("menuitem", { name: "Ask in side chat" })).toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.mouseUp(document);
  expect(screen.getByRole("menu")).toBeVisible();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(onReply).not.toHaveBeenCalled();
});

it("ignores selections in or extending into the composer", () => {
  const { range } = selectMessage();
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  range.setEnd(screen.getByTestId("composer").firstChild!, 4);
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  expect(screen.queryByRole("menu")).toBeNull();
  selection.removeAllRanges();
  range.selectNodeContents(screen.getByTestId("composer"));
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  expect(screen.queryByRole("menu")).toBeNull();
});
