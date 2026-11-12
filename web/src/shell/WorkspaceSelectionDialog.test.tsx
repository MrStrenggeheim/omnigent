import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  WorkspaceSelectionDialog,
  type WorkspaceSelectionHandler,
} from "./WorkspaceSelectionDialog";
import { WorkspaceSelector } from "./WorkspaceSelector";

const state = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("@/hooks/useHosts", () => ({
  useHosts: () => ({
    data: [
      { host_id: "a", name: "Host A", status: "online" },
      { host_id: "b", name: "Host B", status: "online" },
      { host_id: "c", name: "Offline host", status: "offline" },
    ],
  }),
}));
vi.mock("@/hooks/useHostFilesystem", () => ({
  useHostFilesystem: (host: string, path: string) => state.list(host, path),
  useCreateHostDirectory: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock("@/hooks/useHostWorktrees", () => ({
  useHostWorktrees: () => ({ data: [], isFetching: false, isPlaceholderData: false }),
  useVerifiedGitWorktrees: () => [],
}));
beforeEach(() => {
  localStorage.clear();
  state.list.mockImplementation((host, path) => ({
    data: {
      entries: [{ name: "child", path: `${path || `/home/${host}`}/child`, type: "directory" }],
      truncated: false,
    },
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    error: path === "/missing" ? new Error("Directory does not exist") : null,
    refetch: vi.fn(),
  }));
});
afterEach(cleanup);
function mount(onConfirm: WorkspaceSelectionHandler = vi.fn(), extra = {}) {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Reopen
        </button>
        <WorkspaceSelectionDialog
          open={open}
          onOpenChange={setOpen}
          hostId="a"
          initialPath="/work"
          onConfirm={onConfirm}
          {...extra}
        />
      </>
    );
  }
  return render(<Harness />);
}

it("preselects the current host, focuses the editable path, and limits the footer to two actions", async () => {
  mount();
  expect(screen.getByRole("button", { name: /Host A/ })).toHaveAttribute("aria-pressed", "true");
  const path = screen.getByRole("textbox", { name: "Current folder path" });
  expect(path).toBeVisible();
  expect(path).toHaveValue("/work");
  await waitFor(() => expect(path).toHaveFocus());
  expect(
    within(screen.getByTestId("workspace-selection-footer"))
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Cancel", "Use workspace"]);
  expect(screen.getByRole("region", { name: "Host" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Path" })).toBeVisible();
  expect(screen.getByRole("button", { name: /Offline host/ })).toBeDisabled();
});

it("validates a directly typed path and awaits the owner before closing", async () => {
  let finish!: (result: boolean) => void;
  const onConfirm = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  mount(onConfirm);
  fireEvent.change(screen.getByRole("textbox", { name: "Current folder path" }), {
    target: { value: "/work/child" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ hostId: "a", path: "/work/child" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () => finish(false));
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByDisplayValue("/work/child")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  await act(async () => finish(true));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("retains the selected path and shows owner validation errors", async () => {
  mount(async () => {
    throw new Error("Dirty file could not be saved");
  });
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Dirty file could not be saved");
  expect(screen.getByDisplayValue("/work")).toBeVisible();
});

it("does not confirm a missing directory or discard invalid typed input", async () => {
  const onConfirm = vi.fn();
  mount(onConfirm);
  const path = screen.getByRole("textbox", { name: "Current folder path" });
  fireEvent.change(path, { target: { value: "relative" } });
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter an absolute path");
  expect(path).toHaveValue("relative");
  fireEvent.change(path, { target: { value: "/missing" } });
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  await screen.findByText(/Directory does not exist/);
  expect(path).toHaveValue("/missing");
  expect(onConfirm).not.toHaveBeenCalled();
});

it("keeps typed drafts per host and confirms the selected host", async () => {
  const onConfirm = vi.fn();
  mount(onConfirm);
  fireEvent.change(screen.getByRole("textbox", { name: "Current folder path" }), {
    target: { value: "/draft-a" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Host B/ }));
  expect(screen.getByRole("textbox", { name: "Current folder path" })).toHaveValue("/home/b");
  fireEvent.click(screen.getByRole("button", { name: /Host A/ }));
  expect(screen.getByRole("textbox", { name: "Current folder path" })).toHaveValue("/draft-a");
  fireEvent.click(screen.getByRole("button", { name: /Host B/ }));
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ hostId: "b", path: "/home/b" }));
});

it("never lets a cancelled opening close a later opening when its owner finishes", async () => {
  let finish!: () => void;
  mount(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await act(async () => finish());
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("supports a fixed execution host and a cloud target without forcing host selection", () => {
  const view = mount(vi.fn(), { allowHostChange: false });
  expect(screen.queryByRole("button", { name: /Host B/ })).toBeNull();
  view.unmount();
  mount(vi.fn(), {
    hostId: null,
    hostLabel: "Cloud runner",
    pathUnavailableReason: "Created when the runner starts",
  });
  expect(screen.getByText("Created when the runner starts")).toBeVisible();
  expect(screen.getByText("Cloud runner")).toBeVisible();
});

it("uses one borderless host/path trigger with a chevron", () => {
  const onClick = vi.fn();
  render(<WorkspaceSelector hostLabel="Host A" path="/work" onClick={onClick} />);
  const trigger = screen.getByRole("button", { name: "Select workspace: Host A:/work" });
  expect(trigger).toHaveClass("border-0");
  expect(trigger.querySelectorAll("svg")).toHaveLength(2);
  expect(trigger).toHaveTextContent("Host A:/work");
  fireEvent.click(trigger);
  expect(onClick).toHaveBeenCalledOnce();
});
