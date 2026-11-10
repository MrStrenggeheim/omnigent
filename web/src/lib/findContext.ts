export type FindRegion = "chat" | "sidebar" | "explorer" | "file" | "native";
export const REQUEST_FILE_FIND_EVENT = "omnigent:contextual-file-find";

let trackers = 0;
let region: FindRegion = "chat";
let target: Element | null = null;

export function registerFindContext(): () => void {
  if (trackers++ === 0) {
    region = "chat";
    target = null;
  }
  return () => {
    trackers = Math.max(0, trackers - 1);
    if (trackers === 0) target = null;
  };
}

/** Pointer hover is deliberately excluded; callers record only interaction/focus. */
export function recordFindInteraction(eventTarget: EventTarget | null): void {
  const element = eventTarget instanceof Element ? eventTarget : null;
  if (!element) return;
  const owner = element.closest<HTMLElement>("[data-context-search-region]");
  const value = owner?.dataset.contextSearchRegion;
  if (
    element.closest(".xterm") ||
    (element.closest(".monaco-editor, .cm-editor") && value !== "file") ||
    element.tagName === "IFRAME" ||
    value === "native"
  ) {
    region = "native";
    target = element;
  } else if (["chat", "sidebar", "explorer", "file"].includes(value ?? "")) {
    region = value as FindRegion;
    target = element;
  }
}

export function getFindContext(): { region: FindRegion; target: Element | null } | null {
  if (trackers === 0) return null;
  if (target && (!target.isConnected || target.closest('[inert], [aria-hidden="true"]'))) {
    region = "chat";
    target = null;
  }
  return { region, target };
}
