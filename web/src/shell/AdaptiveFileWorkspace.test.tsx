import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdaptiveFileWorkspace } from "./AdaptiveFileWorkspace";
import { ResponsiveViewerSlot } from "./ResponsiveViewerSlot";
import { CommentSenderProvider } from "@/hooks/CommentSenderContext";

const { sendComments } = vi.hoisted(() => ({ sendComments: vi.fn() }));
vi.mock("@/hooks/useComments", () => ({
  useSendCommentsToAgent: () => ({ mutate: sendComments, isPending: false }),
}));

const observers = new Map<Element, ResizeObserverCallback>();
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private targets = new Set<Element>();
      private callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.targets.add(target);
        observers.set(target, this.callback);
      }
      disconnect() {
        for (const target of this.targets) observers.delete(target);
      }
    },
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  observers.clear();
  vi.unstubAllGlobals();
});

function resize(width: number) {
  const target = screen.getByRole("group", { name: "File workspace" });
  act(() =>
    observers.get(target)?.(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, width, 500),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      {} as ResizeObserver,
    ),
  );
}

it.each([
  [719, false, null],
  [720, false, 260],
  [1000, false, 300],
  [1400, false, 320],
  [1400, true, null],
] as const)(
  "uses fallback width %i and mobile %s until measured",
  (width, isMobile, expectedWidth) => {
    render(
      <AdaptiveFileWorkspace width={width} isMobile={isMobile} explorer={<div>Explorer</div>}>
        Viewer
      </AdaptiveFileWorkspace>,
    );
    const explorer = screen.queryByRole("region", { name: "File explorer" });
    if (expectedWidth === null) expect(explorer).toBeNull();
    else expect(explorer).toHaveStyle({ width: `${expectedWidth}px` });
    expect(screen.getByRole("region", { name: "File viewer" })).toHaveTextContent("Viewer");
  },
);

it("preserves the loaded viewer, draft, focus and selection through measured fullscreen and mobile transitions", () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Draft() {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <textarea
        aria-label="File draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const mobileTarget = document.createElement("div");
  document.body.appendChild(mobileTarget);
  const tree = (isMobile = false, agentId: string | null = "bound-agent") => (
    <AdaptiveFileWorkspace width={360} isMobile={isMobile} explorer={<div>Explorer</div>}>
      <ResponsiveViewerSlot mobile={isMobile} mobileTarget={mobileTarget}>
        <CommentSenderProvider sessionId="session" agentId={agentId}>
          <Draft />
        </CommentSenderProvider>
      </ResponsiveViewerSlot>
    </AdaptiveFileWorkspace>
  );
  const view = render(tree(false, null));
  // Async binding changes the real provider structure before content is ready.
  view.rerender(tree());
  const mountsBeforeResize = mounted.mock.calls.length;
  const unmountsBeforeResize = unmounted.mock.calls.length;
  const draft = screen.getByLabelText<HTMLTextAreaElement>("File draft");
  fireEvent.change(draft, { target: { value: "Unsaved edit" } });
  draft.focus();
  draft.setSelectionRange(2, 7, "backward");
  expect(screen.queryByRole("region", { name: "File explorer" })).toBeNull();
  for (const width of [900, 719, 720, 1200, 360, 900]) {
    resize(width);
    expect(!!screen.queryByRole("region", { name: "File explorer" })).toBe(width >= 720);
    expect(screen.getByLabelText("File draft")).toBe(draft);
    expect(draft).toHaveValue("Unsaved edit");
    expect(draft).toHaveFocus();
    expect([draft.selectionStart, draft.selectionEnd, draft.selectionDirection]).toEqual([
      2,
      7,
      "backward",
    ]);
  }
  view.rerender(tree(true));
  expect(screen.queryByRole("region", { name: "File explorer" })).toBeNull();
  expect(mobileTarget).toContainElement(draft);
  view.rerender(tree());
  expect(screen.getByRole("region", { name: "File explorer" })).toBeInTheDocument();
  expect(screen.getByLabelText("File draft")).toBe(draft);
  expect(draft).toHaveValue("Unsaved edit");
  expect(mounted).toHaveBeenCalledTimes(mountsBeforeResize);
  expect(unmounted).toHaveBeenCalledTimes(unmountsBeforeResize);
  view.unmount();
  expect(observers.size).toBe(0);
  mobileTarget.remove();
});

it("does not reserve Explorer space when the session has no file panel", () => {
  render(
    <AdaptiveFileWorkspace width={1000} isMobile={false} explorer={null}>
      Viewer
    </AdaptiveFileWorkspace>,
  );
  expect(screen.queryByRole("region", { name: "File explorer" })).toBeNull();
  expect(screen.getByRole("region", { name: "File viewer" })).toHaveTextContent("Viewer");
});

it("remembers resized Explorer width, clamps to leave viewer room and restores it after narrowing", () => {
  const tree = () => (
    <AdaptiveFileWorkspace width={1000} isMobile={false} explorer={<div>Explorer</div>}>
      <textarea aria-label="Persistent draft" defaultValue="draft" />
    </AdaptiveFileWorkspace>
  );
  const view = render(tree());
  const draft = screen.getByLabelText("Persistent draft");
  let divider = screen.getByRole("separator", { name: "Resize file explorer" });
  fireEvent.keyDown(divider, { key: "End" });
  expect(screen.getByRole("region", { name: "File explorer" })).toHaveStyle({ width: "640px" });
  expect(
    JSON.parse(localStorage.getItem("omnigent:panel-size-preferences")!).explorerColumnWidthPx,
  ).toBe(640);
  resize(720);
  expect(screen.getByRole("region", { name: "File explorer" })).toHaveStyle({ width: "360px" });
  resize(719);
  expect(screen.queryByRole("separator", { name: "Resize file explorer" })).toBeNull();
  resize(1000);
  expect(screen.getByRole("region", { name: "File explorer" })).toHaveStyle({ width: "640px" });
  expect(screen.getByLabelText("Persistent draft")).toBe(draft);
  view.unmount();
  render(tree());
  divider = screen.getByRole("separator", { name: "Resize file explorer" });
  expect(divider).toHaveAttribute("aria-valuenow", "640");
  fireEvent.keyDown(divider, { key: "Home" });
  expect(divider).toHaveAttribute("aria-valuenow", "260");
});
