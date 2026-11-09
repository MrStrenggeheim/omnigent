import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_STORAGE_KEY,
  readDefaultAgentId,
  writeDefaultAgentId,
} from "./defaultAgentPreferences";
import { applyImportedSettings, collectSettings } from "./settingsPortability";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("keeps an explicit default separate from the last-used agent and supports clearing it", () => {
  localStorage.setItem("omnigent:last-agent-id", "remembered");
  expect(readDefaultAgentId()).toBeNull();
  expect(writeDefaultAgentId("  agent-id  ")).toBe(true);
  expect(readDefaultAgentId()).toBe("agent-id");
  expect(localStorage.getItem("omnigent:last-agent-id")).toBe("remembered");
  expect(writeDefaultAgentId(null)).toBe(true);
  expect(localStorage.getItem(DEFAULT_AGENT_STORAGE_KEY)).toBeNull();
});

it("normalizes blank or hand-edited values", () => {
  localStorage.setItem(DEFAULT_AGENT_STORAGE_KEY, "   ");
  expect(readDefaultAgentId()).toBeNull();
  writeDefaultAgentId("some-agent");
  writeDefaultAgentId("  ");
  expect(readDefaultAgentId()).toBeNull();
});

it("reports write failures and tolerates inaccessible storage", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(writeDefaultAgentId("agent-id")).toBe(false);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(writeDefaultAgentId(null)).toBe(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(readDefaultAgentId()).toBeNull();
});

it("works without a browser", () => {
  vi.stubGlobal("window", undefined);
  expect(readDefaultAgentId()).toBeNull();
  expect(writeDefaultAgentId("agent-id")).toBe(false);
});

it("exports, imports, and clears the default through the existing settings registry", () => {
  writeDefaultAgentId("agent-id");
  const exported = collectSettings()!;
  expect(exported.settings[DEFAULT_AGENT_STORAGE_KEY]).toBe("agent-id");
  applyImportedSettings({ version: 1, settings: {} });
  expect(readDefaultAgentId()).toBeNull();
  applyImportedSettings(exported);
  expect(readDefaultAgentId()).toBe("agent-id");
});
