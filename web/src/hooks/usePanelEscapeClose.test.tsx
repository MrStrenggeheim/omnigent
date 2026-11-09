import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePanelEscapeClose } from "./usePanelEscapeClose";

afterEach(cleanup);
function Panel({
  open = true,
  close,
  menu = true,
}: {
  open?: boolean;
  close: () => void;
  menu?: boolean;
}) {
  usePanelEscapeClose(open, close);
  if (!menu) return null;
  return (
    <div role="menu" data-state="open">
      <button type="button">Menu action</button>
    </div>
  );
}
it("leaves the panel open for menu Escape and dismisses it after the menu is gone", () => {
  const close = vi.fn();
  const view = render(<Panel close={close} />);
  fireEvent.keyDown(view.getByRole("button"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  view.rerender(<Panel close={close} menu={false} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});
it("ignores an already consumed Escape and removes the listener when closed", () => {
  const close = vi.fn();
  const view = render(<Panel close={close} />);
  view.rerender(<Panel close={close} menu={false} />);
  const consumed = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  consumed.preventDefault();
  window.dispatchEvent(consumed);
  expect(close).not.toHaveBeenCalled();
  view.rerender(<Panel close={close} open={false} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
});
