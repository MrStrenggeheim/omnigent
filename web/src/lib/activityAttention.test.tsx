import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useViewerId } from "@/hooks/useViewerId";
import { getOmnigentServerIdentity } from "@/lib/host";
import {
  activityAttentionKey,
  parseActivityAttention,
  useActivityAttention,
} from "./activityAttention";

vi.mock("@/hooks/useViewerId", () => ({ useViewerId: vi.fn(() => "account") }));
vi.mock("@/lib/host", () => ({ getOmnigentServerIdentity: vi.fn(() => "server") }));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(useViewerId).mockReturnValue("account");
  vi.mocked(getOmnigentServerIdentity).mockReturnValue("server");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("persists exact read/dismiss revisions, synchronizes mounted views and makes newer results unread", () => {
  const first = renderHook(() => useActivityAttention("chat"));
  const second = renderHook(() => useActivityAttention("chat"));
  act(() => first.result.current.markRead([{ id: "result", revision: "one" }]));
  expect(second.result.current.disposition("result", "one")).toBe("read");
  expect(second.result.current.disposition("result", "two")).toBeUndefined();
  act(() => second.result.current.dismiss([{ id: "failure", revision: "failed" }]));
  expect(first.result.current.disposition("failure", "failed")).toBe("dismissed");
  first.unmount();
  second.unmount();
  const reloaded = renderHook(() => useActivityAttention("chat"));
  expect(reloaded.result.current.disposition("result", "one")).toBe("read");
  expect(reloaded.result.current.disposition("failure", "failed")).toBe("dismissed");
});

it("isolates account, server and conversation without overwriting prior attention", () => {
  const { result, rerender } = renderHook(({ id }) => useActivityAttention(id), {
    initialProps: { id: "a" },
  });
  act(() => result.current.markRead([{ id: "message", revision: "1" }]));
  rerender({ id: "b" });
  expect(result.current.disposition("message", "1")).toBeUndefined();
  rerender({ id: "a" });
  vi.mocked(useViewerId).mockReturnValue("other");
  rerender({ id: "a" });
  expect(result.current.disposition("message", "1")).toBeUndefined();
  vi.mocked(useViewerId).mockReturnValue("account");
  vi.mocked(getOmnigentServerIdentity).mockReturnValue("other");
  rerender({ id: "a" });
  expect(result.current.disposition("message", "1")).toBeUndefined();
  vi.mocked(getOmnigentServerIdentity).mockReturnValue("server");
  rerender({ id: "a" });
  expect(result.current.disposition("message", "1")).toBe("read");
});

it("validates stored data, reports failed persistence, and retains in-memory reads", () => {
  const key = activityAttentionKey({
    accountId: "account",
    serverId: "server",
    conversationId: "chat",
  });
  localStorage.setItem(key, "invalid");
  const { result } = renderHook(() => useActivityAttention("chat"));
  expect(result.current.error).not.toBeNull();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  act(() => result.current.markRead([{ id: "a", revision: "1" }]));
  act(() => result.current.dismiss([{ id: "b", revision: "2" }]));
  expect(result.current.disposition("a", "1")).toBe("read");
  expect(result.current.disposition("b", "2")).toBe("dismissed");
  expect(result.current.error?.message).toBe("Quota exceeded");
  expect(() => parseActivityAttention('{"version":2,"marks":[]}')).toThrow();
  expect(() => parseActivityAttention('{"version":1,"marks":[{}]}')).toThrow();
});

it("does not persist under an anonymous fallback and reloads same-scope browser storage events", () => {
  vi.mocked(useViewerId).mockReturnValue(null);
  const { result, rerender } = renderHook(() => useActivityAttention("chat"));
  act(() => result.current.markRead([{ id: "message", revision: "1" }]));
  expect(localStorage.length).toBe(0);
  vi.mocked(useViewerId).mockReturnValue("account");
  rerender();
  const key = result.current.scopeKey!;
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, marks: [{ id: "message", revision: "1", disposition: "read" }] }),
  );
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  expect(result.current.disposition("message", "1")).toBe("read");
});
