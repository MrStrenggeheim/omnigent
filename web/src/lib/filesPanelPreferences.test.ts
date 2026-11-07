import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FILES_PANEL_PREFERENCES,
  readFilesPanelPreferences,
  subscribeFilesPanelPreferences,
  writeFilesPanelPreferences,
} from "./filesPanelPreferences";

const STORAGE_KEY = "omnigent:files-panel-preferences";

afterEach(() => {
  localStorage.clear();
});

describe("filesPanelPreferences", () => {
  it("defaults the sort order when nothing is stored", () => {
    expect(readFilesPanelPreferences()).toEqual(DEFAULT_FILES_PANEL_PREFERENCES);
    expect(DEFAULT_FILES_PANEL_PREFERENCES.sort).toBe("recent");
    expect(DEFAULT_FILES_PANEL_PREFERENCES.showAgentChanges).toBe(false);
  });

  it("round-trips a written preference", () => {
    writeFilesPanelPreferences({ sort: "alpha" });
    expect(readFilesPanelPreferences()).toEqual({ sort: "alpha", showAgentChanges: false });
  });

  it("falls back to defaults on malformed JSON", () => {
    // A non-JSON string must not throw; read swallows the parse error so a
    // corrupt entry can't break the panel.
    localStorage.setItem(STORAGE_KEY, "}{not json");
    expect(readFilesPanelPreferences()).toEqual(DEFAULT_FILES_PANEL_PREFERENCES);
  });

  it("falls back to defaults when the stored value is not an object", () => {
    // Valid JSON but the wrong shape (an array) must be rejected wholesale.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([true]));
    expect(readFilesPanelPreferences()).toEqual(DEFAULT_FILES_PANEL_PREFERENCES);
  });

  it("defaults sort when the stored value is invalid", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sort: "bogus" }));
    expect(readFilesPanelPreferences()).toEqual({ sort: "recent", showAgentChanges: false });
  });

  it("preserves the toggle when an older caller writes only sort", () => {
    writeFilesPanelPreferences({ showAgentChanges: true });
    writeFilesPanelPreferences({ sort: "alpha" });
    expect(readFilesPanelPreferences()).toEqual({ sort: "alpha", showAgentChanges: true });
    writeFilesPanelPreferences({ showAgentChanges: false });
    expect(readFilesPanelPreferences()).toEqual({ sort: "alpha", showAgentChanges: false });
  });

  it.each([undefined, "true", 1, null])("defaults an invalid toggle: %s", (showAgentChanges) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sort: "size", showAgentChanges }));
    expect(readFilesPanelPreferences()).toEqual({ sort: "size", showAgentChanges: false });
  });

  it("notifies subscribers for local writes and cross-tab changes, then unsubscribes", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeFilesPanelPreferences(changed);
    writeFilesPanelPreferences({ showAgentChanges: true });
    expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    writeFilesPanelPreferences({ sort: "type" });
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(changed).toHaveBeenCalledTimes(3);
  });
});
