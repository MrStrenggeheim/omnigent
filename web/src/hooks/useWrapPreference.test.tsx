import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "@/lib/notifications";
import { useWrapPreference, type WrapScope } from "./useWrapPreference";

vi.mock("@/lib/notifications", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("remembers three independent wrap preferences and synchronizes mounted consumers", () => {
  const chat = renderHook(() => useWrapPreference("chat"));
  const input = renderHook(() => useWrapPreference("tool-input"));
  const output = renderHook(() => useWrapPreference("tool-output"));
  const anotherInput = renderHook(() => useWrapPreference("tool-input"));
  expect([chat, input, output].map((hook) => hook.result.current[0])).toEqual([true, true, true]);
  act(() => input.result.current[1](false));
  expect(anotherInput.result.current[0]).toBe(false);
  expect(chat.result.current[0]).toBe(true);
  expect(output.result.current[0]).toBe(true);
  input.unmount();
  const restored = renderHook(() => useWrapPreference("tool-input"));
  expect(restored.result.current[0]).toBe(false);
  act(() => output.result.current[1](false));
  expect(localStorage.getItem("omnigent:wrap:tool-output")).toBe("false");
  expect(localStorage.getItem("omnigent:wrap:chat")).toBeNull();
  act(() => chat.result.current[1](false));
  expect(localStorage.getItem("omnigent:wrap:chat")).toBe("false");
  expect(restored.result.current[0]).toBe(false);
});

it("applies functional updates against the latest stored value", () => {
  const { result } = renderHook(() => useWrapPreference("chat"));
  act(() => {
    result.current[1]((value) => !value);
    result.current[1]((value) => !value);
  });
  expect(result.current[0]).toBe(true);
  expect(localStorage.getItem("omnigent:wrap:chat")).toBe("true");
});

it("follows scope changes without overwriting another scope", () => {
  localStorage.setItem("omnigent:wrap:tool-input", "false");
  const { result, rerender } = renderHook(
    ({ scope }: { scope: WrapScope }) => useWrapPreference(scope),
    {
      initialProps: { scope: "tool-input" },
    },
  );
  expect(result.current[0]).toBe(false);
  rerender({ scope: "tool-output" });
  expect(result.current[0]).toBe(true);
  act(() => result.current[1](false));
  rerender({ scope: "tool-input" });
  act(() => result.current[1](true));
  expect(localStorage.getItem("omnigent:wrap:tool-output")).toBe("false");
});

it("refreshes from other tabs and resets to wrapping when storage is cleared", () => {
  const { result } = renderHook(() => useWrapPreference("tool-output"));
  act(() => {
    localStorage.setItem("omnigent:wrap:tool-output", "false");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "omnigent:wrap:tool-output", newValue: "false" }),
    );
  });
  expect(result.current[0]).toBe(false);
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(result.current[0]).toBe(true);
});

it("defaults to wrapping when storage cannot be read and reports failed writes", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { result } = renderHook(() => useWrapPreference("chat"));
  expect(result.current[0]).toBe(true);
  act(() => result.current[1](false));
  expect(toast.error).toHaveBeenCalledWith(
    "Could not remember word wrap. Browser storage is unavailable.",
  );
});
