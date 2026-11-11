import { StrictMode, useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSettingsNavigationVisibility } from "./useSettingsNavigationVisibility";

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("./useIsMobileViewport", () => ({ useIsMobileViewport: () => viewport.mobile }));

beforeEach(() => {
  viewport.mobile = false;
});
afterEach(cleanup);

function mount(initialOpen: boolean, initialSettings = false, initiallyEnabled = true) {
  return renderHook(
    ({ inSettings, enabled }) => {
      const [sidebarOpen, setSidebarOpen] = useState(initialOpen);
      useSettingsNavigationVisibility({ inSettings, sidebarOpen, setSidebarOpen, enabled });
      return { sidebarOpen, setSidebarOpen };
    },
    {
      initialProps: { inSettings: initialSettings, enabled: initiallyEnabled },
      wrapper: StrictMode,
    },
  );
}

it.each([false, true])(
  "reveals desktop navigation and restores its prior state (%s)",
  (initialOpen) => {
    const { result, rerender } = mount(initialOpen);
    rerender({ inSettings: true, enabled: true });
    expect(result.current.sidebarOpen).toBe(true);
    rerender({ inSettings: true, enabled: true });
    act(() => result.current.setSidebarOpen(false));
    rerender({ inSettings: false, enabled: true });
    expect(result.current.sidebarOpen).toBe(initialOpen);
    // A second visit captures the current preference, not the first visit's value.
    act(() => result.current.setSidebarOpen(!initialOpen));
    rerender({ inSettings: true, enabled: true });
    rerender({ inSettings: false, enabled: true });
    expect(result.current.sidebarOpen).toBe(!initialOpen);
  },
);

it("handles a direct Settings entry under Strict Mode", () => {
  const { result, rerender } = mount(false, true);
  expect(result.current.sidebarOpen).toBe(true);
  rerender({ inSettings: false, enabled: true });
  expect(result.current.sidebarOpen).toBe(false);
});

it("keeps mobile content accessible without opening the drawer and restores on exit", () => {
  viewport.mobile = true;
  const { result, rerender } = mount(false, true);
  expect(result.current.sidebarOpen).toBe(false);
  act(() => result.current.setSidebarOpen(true));
  rerender({ inSettings: false, enabled: true });
  expect(result.current.sidebarOpen).toBe(false);
});

it("reveals navigation when a Settings visit becomes desktop without replacing the original state", () => {
  viewport.mobile = true;
  const { result, rerender } = mount(false, true);
  viewport.mobile = false;
  rerender({ inSettings: true, enabled: true });
  expect(result.current.sidebarOpen).toBe(true);
  rerender({ inSettings: false, enabled: true });
  expect(result.current.sidebarOpen).toBe(false);
});

it("ignores inactive shells and restores their state on deactivation", () => {
  const { result, rerender } = mount(false, true, false);
  expect(result.current.sidebarOpen).toBe(false);
  rerender({ inSettings: true, enabled: true });
  expect(result.current.sidebarOpen).toBe(true);
  rerender({ inSettings: true, enabled: false });
  expect(result.current.sidebarOpen).toBe(false);
});
