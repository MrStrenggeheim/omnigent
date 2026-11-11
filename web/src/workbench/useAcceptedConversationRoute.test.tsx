import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useAcceptedConversationRoute } from "./useAcceptedConversationRoute";

const onError = vi.fn();
afterEach(cleanup);
function RouteHarness({
  accept,
  onAccepted,
}: {
  accept: (id: string) => Promise<boolean>;
  onAccepted: (id: string) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const skip = useRef<string | null>(null);
  const href = location.pathname + location.search + location.hash;
  const active = !location.pathname.startsWith("/canvas");
  const id = location.pathname.match(/^\/c\/(.+)$/)?.[1];
  const accepted = useAcceptedConversationRoute({
    active,
    conversationId: id,
    href,
    scopeKey: "scope",
    skip,
    accept,
    onAccepted,
    navigate,
    onError,
  });
  return (
    <>
      <output aria-label="url">{href}</output>
      <output aria-label="accepted">{accepted}</output>
      <button type="button" onClick={() => navigate("/c/b")}>
        Open B
      </button>
      <button type="button" onClick={() => navigate("/canvas")}>
        Canvas
      </button>
    </>
  );
}
it("restores the full accepted URL on cancel and accepts a repeated selection", async () => {
  const accept = vi.fn(async (id: string) => id !== "b");
  const onAccepted = vi.fn();
  render(
    <MemoryRouter initialEntries={["/c/a?file=keep#anchor"]}>
      <RouteHarness accept={accept} onAccepted={onAccepted} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("a"));
  fireEvent.click(screen.getByText("Open B"));
  await waitFor(() => expect(accept).toHaveBeenCalledWith("b"));
  await waitFor(() =>
    expect(screen.getByLabelText("url")).toHaveTextContent("/c/a?file=keep#anchor"),
  );
  expect(accept.mock.calls.filter(([id]) => id === "a")).toHaveLength(1);
  accept.mockResolvedValue(true);
  fireEvent.click(screen.getByText("Open B"));
  await waitFor(() => expect(screen.getByLabelText("accepted")).toHaveTextContent("/c/b"));
  expect(accept.mock.calls.filter(([id]) => id === "b")).toHaveLength(2);
});
it("ignores an outstanding route decision after the workbench becomes inactive", async () => {
  let finish!: (allowed: boolean) => void;
  const accept = vi.fn((id: string) =>
    id === "b"
      ? new Promise<boolean>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(true),
  );
  const onAccepted = vi.fn();
  render(
    <MemoryRouter initialEntries={["/c/a"]}>
      <RouteHarness accept={accept} onAccepted={onAccepted} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("a"));
  fireEvent.click(screen.getByText("Open B"));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(screen.getByText("Canvas"));
  await act(async () => finish(false));
  expect(screen.getByLabelText("url")).toHaveTextContent("/canvas");
  expect(onAccepted).not.toHaveBeenCalledWith("b");
});
