import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkspacePickerDialog } from "./WorkspacePickerDialog";

vi.mock("./WorkspaceSelectionDialog", () => ({
  WorkspaceSelectionDialog: ({
    allowHostChange,
    hostId,
    initialPath,
    onConfirm,
    onCancel,
  }: {
    allowHostChange: boolean;
    hostId: string | null;
    initialPath?: string;
    onConfirm: (selection: { hostId: string | null; path: string }) => unknown;
    onCancel?: () => void;
  }) => (
    <div
      data-testid="combined"
      data-fixed-host={!allowHostChange}
      data-host={hostId}
      data-path={initialPath}
    >
      <button type="button" onClick={() => onConfirm({ hostId, path: "/chosen" })}>
        Use workspace
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));
it("adapts path-only callers to the shared dialog while retaining their fixed host", () => {
  const onConfirm = vi.fn(() => false);
  const onCancel = vi.fn();
  render(
    <WorkspacePickerDialog
      open
      onOpenChange={vi.fn()}
      hostId="host"
      initialPath="/initial"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByTestId("combined")).toHaveAttribute("data-fixed-host", "true");
  expect(screen.getByTestId("combined")).toHaveAttribute("data-path", "/initial");
  fireEvent.click(screen.getByRole("button", { name: "Use workspace" }));
  expect(onConfirm).toHaveBeenCalledWith("/chosen");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
});
