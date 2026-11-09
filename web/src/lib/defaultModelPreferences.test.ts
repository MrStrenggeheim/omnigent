import { afterEach, expect, it, vi } from "vitest";
import {
  availableDefaultModel,
  readDefaultModel,
  writeDefaultModel,
  DEFAULT_MODELS_STORAGE_KEY,
} from "./defaultModelPreferences";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("keeps independent harness choices and distinguishes inheritance from harness default", () => {
  expect(readDefaultModel("codex-native")).toBeUndefined();
  expect(writeDefaultModel("codex-native", "model-a")).toBe(true);
  writeDefaultModel("claude-native", "");
  expect(readDefaultModel("codex-native")).toBe("model-a");
  expect(readDefaultModel("claude-native")).toBe("");
  writeDefaultModel("codex-native", undefined);
  expect(readDefaultModel("codex-native")).toBeUndefined();
  expect(readDefaultModel("claude-native")).toBe("");
});
it("drops invalid storage fields and reports a failed save", () => {
  localStorage.setItem(
    DEFAULT_MODELS_STORAGE_KEY,
    JSON.stringify({ good: "model", broken: false }),
  );
  expect(readDefaultModel("broken")).toBeUndefined();
  expect(readDefaultModel("good")).toBe("model");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  expect(writeDefaultModel("good", "new")).toBe(false);
  expect(readDefaultModel("good")).toBe("model");
});
it.each([
  [undefined, undefined],
  [null, undefined],
  ["", ""],
  ["retired", ""],
  ["model-a", "model-a"],
])("resolves configured %s against the live vocabulary", (configured, expected) => {
  expect(availableDefaultModel(configured, [{ id: "model-a" }])).toBe(expected);
});
