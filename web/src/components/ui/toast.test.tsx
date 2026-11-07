import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  toast,
  getNotificationSnapshot,
  setNotificationCenterOpen,
  notify,
} from "@/lib/notifications";
import { NotificationBell, NotificationLayoutProvider } from "@/components/NotificationCenter";
import { TooltipProvider } from "./tooltip";
import { Toaster } from "./sonner";
import { showToast } from "./toast";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  toast.dismiss();
  setNotificationCenterOpen(false);
});
afterEach(() => {
  act(() => {
    toast.dismiss();
    setNotificationCenterOpen(false);
  });
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});
function mount() {
  return render(
    <TooltipProvider>
      <NotificationLayoutProvider width={320} bottom="16px">
        <NotificationBell />
        <Toaster />
      </NotificationLayoutProvider>
    </TooltipProvider>,
  );
}

describe("shared notifications", () => {
  it("opens only one center when existing headers share the bell", () => {
    render(
      <NotificationLayoutProvider width={320} bottom="16px">
        <NotificationBell />
        <NotificationBell />
        <Toaster />
      </NotificationLayoutProvider>,
    );
    const bells = screen.getAllByRole("button", { name: "Notifications" });
    fireEvent.click(bells[0]);
    expect(screen.getAllByRole("dialog", { name: "Notifications" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    fireEvent.click(bells[1]);
    expect(screen.getAllByRole("dialog", { name: "Notifications" })).toHaveLength(1);
  });

  it("renders nothing until a notification is shown", () => {
    render(<Toaster />);
    expect(document.querySelector("[data-notification-card]")).toBeNull();
  });

  it("hides compatibility content without deleting its history", async () => {
    mount();
    act(() => showToast(<span>Hello there</span>, { duration: 0 }));
    expect(await screen.findByTestId("toast")).toHaveTextContent("Hello there");
    fireEvent.click(screen.getByRole("button", { name: "Hide notification" }));
    expect(screen.queryByTestId("toast")).toBeNull();
    expect(getNotificationSnapshot().entries).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByRole("dialog", { name: "Notifications" })).toHaveTextContent(
      "Hello there",
    );
  });

  it("retains working actions after a popup automatically collapses", async () => {
    mount();
    const undo = vi.fn();
    act(() =>
      toast.success("Archived project", {
        description: "Research",
        action: { label: "Undo", onClick: undo },
      }),
    );
    await act(() => vi.advanceTimersByTimeAsync(10_001));
    expect(screen.queryByText("Archived project")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByRole("dialog", { name: "Notifications" })).toHaveTextContent(
      "Research",
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undo).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("pauses while hovered and retains required prompts above recent notices", async () => {
    mount();
    act(() =>
      toast.custom(() => <button type="button">Allow copying</button>, {
        id: "permission",
        dismissible: false,
        duration: Infinity,
      }),
    );
    act(() => toast("Read this", { testId: "read" }));
    fireEvent.pointerEnter(await screen.findByTestId("read"));
    await act(() => vi.advanceTimersByTimeAsync(11_000));
    expect(screen.getByTestId("read")).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByTestId("read"));
    await act(() => vi.advanceTimersByTimeAsync(10_001));
    expect(screen.queryByTestId("read")).toBeNull();
    act(() => {
      for (let index = 0; index < 5; index++) toast(`Notice ${index}`);
    });
    expect(screen.getByRole("button", { name: "Allow copying" })).toBeInTheDocument();
    expect(screen.getByText("Notice 4")).toBeInTheDocument();
    expect(screen.queryByText("Notice 0")).toBeNull();
    expect(document.querySelectorAll("[data-notification-card]")).toHaveLength(4);
  });

  it("uses the same card and width for activity and ordinary messages", () => {
    mount();
    act(() => {
      toast("Project saved", { testId: "ordinary" });
      notify({
        title: "Uploading files",
        testId: "activity",
        progress: { active: true, value: 25, label: "25%" },
      });
    });
    const normal = screen.getByTestId("ordinary");
    const progress = screen.getByTestId("activity");
    expect(normal.className).toBe(progress.className);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(normal.closest("aside")).toHaveStyle({ width: "320px", maxWidth: "calc(100vw - 2rem)" });
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear completed notifications" }));
    expect(screen.queryByText("Project saved")).toBeNull();
    expect(screen.getByText("Uploading files")).toBeInTheDocument();
  });
});
