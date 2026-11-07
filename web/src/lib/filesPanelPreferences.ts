// App-global Explorer preferences, shared across Files and Changes surfaces.

import { type ChangedSort, isValidSort } from "@/lib/changedSort";

export interface FilesPanelPreferences {
  /** Sort order for the changed-files flat list. */
  sort: ChangedSort;
  /** Whether legacy session edits overlay the live Git changes. */
  showAgentChanges: boolean;
}

const STORAGE_KEY = "omnigent:files-panel-preferences";
const CHANGE_EVENT = "omnigent:files-panel-preferences-changed";

export const DEFAULT_FILES_PANEL_PREFERENCES: FilesPanelPreferences = {
  sort: "recent",
  showAgentChanges: false,
};

/**
 * Read the persisted Files-panel preference. Returns the default when nothing
 * is stored, on a server render (no `window`), or when the stored value is
 * malformed — never throws, so a corrupt entry can't break the app.
 */
export function readFilesPanelPreferences(): FilesPanelPreferences {
  if (typeof window === "undefined") return DEFAULT_FILES_PANEL_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILES_PANEL_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return DEFAULT_FILES_PANEL_PREFERENCES;
    }
    const p = parsed as Record<string, unknown>;
    return {
      sort:
        typeof p.sort === "string" && isValidSort(p.sort)
          ? p.sort
          : DEFAULT_FILES_PANEL_PREFERENCES.sort,
      showAgentChanges:
        typeof p.showAgentChanges === "boolean"
          ? p.showAgentChanges
          : DEFAULT_FILES_PANEL_PREFERENCES.showAgentChanges,
    };
  } catch {
    return DEFAULT_FILES_PANEL_PREFERENCES;
  }
}

/**
 * Persist the Files-panel preference. Swallows quota/access errors so a failed
 * write can't break the panel.
 */
export function writeFilesPanelPreferences(prefs: Partial<FilesPanelPreferences>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readFilesPanelPreferences(), ...prefs }),
    );
  } catch {
    // localStorage quota or access errors shouldn't break the app.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subscribe to writes in this window and preference changes in other tabs. */
export function subscribeFilesPanelPreferences(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
