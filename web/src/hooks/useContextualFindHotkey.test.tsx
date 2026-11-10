import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getFindContext, REQUEST_FILE_FIND_EVENT } from "@/lib/findContext";
import { useContextualFindHotkey } from "./useContextualFindHotkey";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function setup(isMac = false, enabled = true) {
  const onChatFind = vi.fn();
  const onExplorerFind = vi.fn();
  const hook = renderHook(() =>
    useContextualFindHotkey({ onChatFind, onExplorerFind, isMac, enabled }),
  );
  const key = (init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(window, {
      key: "f",
      ...(isMac ? { metaKey: true } : { ctrlKey: true }),
      ...init,
    });
  function region(name: string, content = "Plain text") {
    const root = document.createElement("section");
    root.dataset.contextSearchRegion = name;
    const child = document.createElement("span");
    child.textContent = content;
    root.append(child);
    document.body.append(root);
    return child;
  }
  return { ...hook, onChatFind, onExplorerFind, key, region };
}

it.each([false, true])("routes by interaction and focus, never hover (Mac=%s)", (isMac) => {
  const { key, region, onChatFind, onExplorerFind } = setup(isMac);
  const explorer = region("explorer");
  const sidebar = region("sidebar");
  const chat = region("chat");
  key();
  expect(onChatFind).toHaveBeenLastCalledWith("current");
  fireEvent.mouseOver(explorer);
  key();
  expect(onExplorerFind).not.toHaveBeenCalled();
  fireEvent.mouseDown(explorer);
  key();
  expect(onExplorerFind).toHaveBeenCalledOnce();
  fireEvent.focusIn(sidebar);
  key();
  expect(onChatFind).toHaveBeenLastCalledWith("all");
  fireEvent.pointerDown(chat);
  key();
  expect(onChatFind).toHaveBeenLastCalledWith("current");
});

it("requests find for the exact last file surface and preserves default ownership elsewhere", () => {
  const { key, region, onChatFind, onExplorerFind } = setup();
  const file = region("file");
  const request = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener(REQUEST_FILE_FIND_EVENT, request);
  try {
    fireEvent.mouseDown(file);
    expect(key()).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect((request.mock.calls[0][0] as CustomEvent).detail.target).toBe(file);
    expect(onChatFind).not.toHaveBeenCalled();
    expect(onExplorerFind).not.toHaveBeenCalled();
    file.parentElement!.remove();
    key();
    expect(onChatFind).toHaveBeenCalledWith("current");
  } finally {
    window.removeEventListener(REQUEST_FILE_FIND_EVENT, request);
  }
});

it.each(["xterm", "monaco-editor", "cm-editor"])(
  "leaves %s shortcuts to their owner",
  (className) => {
    const { key, region, onChatFind, onExplorerFind } = setup();
    const editor = region("chat");
    editor.className = className;
    fireEvent.focusIn(editor);
    expect(key()).toBe(true);
    expect(onChatFind).not.toHaveBeenCalled();
    expect(onExplorerFind).not.toHaveBeenCalled();
  },
);

it("still routes Monaco in a file preview to file find", () => {
  const { key, region } = setup();
  const editor = region("file");
  editor.className = "monaco-editor";
  fireEvent.focusIn(editor);
  key();
  expect(getFindContext()?.region).toBe("file");
});

it.each([{ shiftKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }])(
  "does not claim another gesture or composition: %j",
  (init) => {
    const { key, onChatFind, onExplorerFind } = setup();
    expect(key(init)).toBe(true);
    expect(onChatFind).not.toHaveBeenCalled();
    expect(onExplorerFind).not.toHaveBeenCalled();
  },
);

it("honors consumed events and disabled embedded-host bindings", () => {
  const { onChatFind, onExplorerFind, unmount } = setup();
  const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true });
  event.preventDefault();
  window.dispatchEvent(event);
  expect(onChatFind).not.toHaveBeenCalled();
  expect(onExplorerFind).not.toHaveBeenCalled();
  unmount();
  const disabled = setup(false, false);
  disabled.key();
  expect(disabled.onChatFind).not.toHaveBeenCalled();
  expect(getFindContext()).toBeNull();
});

it("does not swallow native find when a file preview has no app search handler", () => {
  const { key, region, onChatFind } = setup();
  fireEvent.mouseDown(region("file"));
  expect(key()).toBe(true);
  expect(onChatFind).not.toHaveBeenCalled();
});
