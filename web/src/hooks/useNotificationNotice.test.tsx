import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getNotificationSnapshot, hideNotification, toast } from "@/lib/notifications";
import { useNotificationNotice } from "./useNotificationNotice";

function Notice({ id = "resource-a", active = true, progress = 10, phase = "working" }) {
  useNotificationNotice(
    id,
    active
      ? {
          title: "Resource operation",
          type: "warning",
          description: id,
          jsx: <button type="button">Resource control</button>,
          action: { label: "Retry", onClick: vi.fn() },
          progress: { value: progress, active: true },
        }
      : null,
    phase,
  );
  return null;
}
const entry = (id = "resource-a") =>
  getNotificationSnapshot().entries.find((item) => item.id === id);

beforeEach(() => {
  vi.useFakeTimers();
  toast.dismiss();
});
afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.useRealTimers();
});

it("survives StrictMode and keeps progress updates from extending the popup countdown", () => {
  const view = render(
    <StrictMode>
      <Notice />
    </StrictMode>,
  );
  expect(entry()?.visible).toBe(true);
  act(() => vi.advanceTimersByTime(8_000));
  view.rerender(
    <StrictMode>
      <Notice progress={80} />
    </StrictMode>,
  );
  act(() => vi.advanceTimersByTime(4_000));
  expect(entry()?.visible).toBe(false);
  expect(entry()?.progress?.value).toBe(80);
  expect(entry()?.action).toMatchObject({ label: "Retry" });
});

it("keeps hidden updates in history and reveals a changed phase", () => {
  const view = render(<Notice />);
  act(() => hideNotification("resource-a"));
  view.rerender(<Notice progress={50} />);
  expect(entry()?.visible).toBe(false);
  view.rerender(<Notice progress={50} phase="failed" />);
  expect(entry()?.visible).toBe(true);
});

it("retires controls and progress when the resource changes or its view closes", () => {
  const view = render(<Notice />);
  view.rerender(<Notice id="resource-b" />);
  expect(entry()).toMatchObject({
    visible: false,
    action: undefined,
    jsx: undefined,
    description: "resource-a",
    progress: { active: false },
  });
  expect(entry("resource-b")?.visible).toBe(true);
  view.unmount();
  expect(entry("resource-b")).toMatchObject({
    visible: false,
    action: undefined,
    progress: { active: false },
  });
});

it("retains history after resolution and respects an explicitly removed notice", () => {
  const view = render(<Notice />);
  act(() => toast.dismiss("resource-a"));
  view.rerender(<Notice progress={20} />);
  expect(entry()).toBeUndefined();
  view.rerender(<Notice phase="failed" />);
  expect(entry()?.visible).toBe(true);
  view.rerender(<Notice active={false} />);
  expect(entry()).toMatchObject({ visible: false, action: undefined });
});
