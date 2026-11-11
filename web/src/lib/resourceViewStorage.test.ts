import { beforeEach, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ account: "alice" as string | null, server: "server-a" }));
vi.mock("./host", () => ({ getOmnigentServerIdentity: () => identity.server }));
vi.mock("./identity", () => ({ getCurrentUserId: () => identity.account }));
beforeEach(() => {
  localStorage.clear();
  identity.account = "alice";
  identity.server = "server-a";
  vi.resetModules();
});
it("restores folder, filters, ordering and scroll after reload within the same account and server", async () => {
  const storage = await import("./resourceViewStorage");
  storage.writeResourceViewState("folder", "/repo/src");
  storage.writeResourceViewState("filters", { query: "needle", hidden: true, sort: "alpha" });
  storage.writeResourceViewState("scroll", 275);
  storage.writeResourceViewState("expanded", new Set(["root", "child"]));
  vi.resetModules();
  const restored = await import("./resourceViewStorage");
  expect(restored.readResourceViewState("folder")).toBe("/repo/src");
  expect(restored.readResourceViewState("filters")).toEqual({
    query: "needle",
    hidden: true,
    sort: "alpha",
  });
  expect(restored.readResourceViewState("scroll")).toBe(275);
  expect(restored.readResourceViewState("expanded")).toEqual(new Set(["root", "child"]));
  identity.account = "bob";
  expect(restored.readResourceViewState("folder")).toBeUndefined();
  identity.account = "alice";
  identity.server = "server-b";
  expect(restored.readResourceViewState("folder")).toBeUndefined();
  identity.server = "server-a";
  expect(restored.readResourceViewState("folder")).toBe("/repo/src");
});
it("bounds saved entries and does not persist an unresolved identity", async () => {
  const storage = await import("./resourceViewStorage");
  for (let index = 0; index < 510; index++) storage.writeResourceViewState(`view-${index}`, index);
  expect(storage.readResourceViewState("view-0")).toBeUndefined();
  expect(storage.readResourceViewState("view-509")).toBe(509);
  const count = localStorage.length;
  identity.account = null;
  expect(storage.writeResourceViewState("unknown", "session-only")).toBe(false);
  expect(localStorage.length).toBe(count);
});
