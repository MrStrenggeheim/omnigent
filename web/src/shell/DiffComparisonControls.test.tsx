import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useAgentTurnChoices } from "@/hooks/useWorkspaceComparisons";
import {
  DEFAULT_DIFF_COMPARISON,
  DiffComparisonControls,
  REPOSITORY_COMPARISON_HINT,
  type DiffComparison,
} from "./DiffComparisonControls";

vi.mock("@/hooks/useWorkspaceComparisons", () => ({
  useAgentTurnChoices: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

beforeEach(() => {
  vi.mocked(useAgentTurnChoices)
    .mockReset()
    .mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useAgentTurnChoices>);
});
afterEach(cleanup);

function setup(
  initial: DiffComparison = DEFAULT_DIFF_COMPARISON,
  options: Partial<ComponentProps<typeof DiffComparisonControls>> = {},
) {
  const changed = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <DiffComparisonControls
        repositoryRoot
        {...options}
        value={value}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  const view = render(<Harness />);
  return { changed, ...view };
}

async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Diff comparison" }), {
    key: "ArrowDown",
  });
  return screen.findByRole("menu");
}

async function chooseComparison(label: string) {
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${label}`) }));
}

async function chooseOption(name: string, label: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("DiffComparisonControls", () => {
  it("defaults to HEAD against current files and exposes the five comparison modes", async () => {
    const { changed } = setup();
    expect(screen.getByRole("button", { name: "Diff comparison" })).toHaveTextContent("Git");
    expect(screen.getByText("HEAD → current files")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await openMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    for (const label of ["Git", "Turn", "Chat", "Since", "Revisions"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(`^${label}`) })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    expect(changed).not.toHaveBeenCalled();
  });

  it("compares a trimmed commit revision against its parent only after submission", async () => {
    const { changed } = setup();
    await chooseComparison("Revisions");
    await chooseOption("Revision comparison type", "Single commit");
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Base revision" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Commit revision" }), {
      target: { value: " a1b2c3 " },
    });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      source: "commit",
      base: "a1b2c3^",
      target: "a1b2c3",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("a1b2c3^ → a1b2c3")).toBeInTheDocument();
  });

  it("forwards both range revisions and resets them when returning to current files", async () => {
    const { changed } = setup();
    await chooseComparison("Revisions");
    fireEvent.change(screen.getByRole("textbox", { name: "Base revision" }), {
      target: { value: " release/v1 " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Target revision" }), {
      target: { value: " feature/topic " },
    });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      source: "range",
      base: "release/v1",
      target: "feature/topic",
    });
    await chooseComparison("Git");
    expect(changed).toHaveBeenLastCalledWith(DEFAULT_DIFF_COMPARISON);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("compares a trimmed revision with current files", async () => {
    const { changed } = setup();
    await chooseComparison("Since");
    fireEvent.change(screen.getByRole("textbox", { name: "Commit revision" }), {
      target: { value: " release/v2 " },
    });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      source: "since",
      base: "release/v2",
      target: "WORKTREE",
    });
    expect(screen.getByText("release/v2 → current files")).toBeInTheDocument();
  });

  it.each([
    { source: "since" as const, field: "Commit revision", menu: "Since" },
    { source: "commit" as const, field: "Commit revision", menu: "Revisions" },
    { source: "range" as const, field: "Base revision", menu: "Revisions" },
    { source: "range" as const, field: "Target revision", menu: "Revisions" },
  ])("disables Compare for a blank $source $field", async ({ source, field, menu }) => {
    const { changed } = setup({ ...DEFAULT_DIFF_COMPARISON, source });
    await chooseComparison(menu);
    fireEvent.change(screen.getByRole("textbox", { name: field }), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(changed).not.toHaveBeenCalled();
  });

  it("cancels draft revisions without changing the selected comparison", async () => {
    const { changed } = setup();
    await chooseComparison("Since");
    fireEvent.change(screen.getByRole("textbox", { name: "Commit revision" }), {
      target: { value: "draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diff comparison" })).toHaveTextContent("Git");
    await chooseComparison("Since");
    expect(screen.getByRole("textbox", { name: "Commit revision" })).toHaveValue("HEAD");
  });

  it("keeps commit actions disabled with an explanation outside a repository root", async () => {
    const { changed } = setup(DEFAULT_DIFF_COMPARISON, { repositoryRoot: false });
    await openMenu();
    for (const label of ["Since", "Revisions"]) {
      const item = screen.getByRole("menuitem", { name: new RegExp(`^${label}`) });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveAccessibleDescription(REPOSITORY_COMPARISON_HINT);
      fireEvent.click(item);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("menuitem", { name: /^Chat/ }));
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      ...DEFAULT_DIFF_COMPARISON,
      source: "agent",
      turnId: undefined,
    });
    expect(screen.getByText("Recorded agent edits · captured coverage")).toBeInTheDocument();
  });

  it("closes the revision form when the panel stops being a repository root", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DiffComparisonControls value={DEFAULT_DIFF_COMPARISON} onChange={onChange} repositoryRoot />,
    );
    await chooseComparison("Revisions");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(
      <DiffComparisonControls
        value={DEFAULT_DIFF_COMPARISON}
        onChange={onChange}
        repositoryRoot={false}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("loads scoped turn choices lazily and cancels without changing the selected comparison", async () => {
    vi.mocked(useAgentTurnChoices).mockReturnValue({
      data: { turns: [{ id: "captured-1", label: "Turn 1 · Update tests", finished: true }] },
      isLoading: false,
    } as ReturnType<typeof useAgentTurnChoices>);
    const { changed } = setup(DEFAULT_DIFF_COMPARISON, {
      sessionId: "session-1",
      scopePath: "repo",
    });
    expect(useAgentTurnChoices).not.toHaveBeenCalled();
    await chooseComparison("Turn");
    await chooseOption("Agent turn", "Turn 1 · Update tests");
    expect(useAgentTurnChoices).toHaveBeenLastCalledWith("session-1", "repo", true);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Diff comparison" })).toHaveTextContent("Git");
  });

  it.each([
    { option: "Last completed turn", turnId: undefined, label: "Last agent turn" },
    { option: "Turn 2 · Fix parser", turnId: "turn-2", label: "Turn 2 · Fix parser" },
    { option: "Current agent turn · in progress", turnId: "current", label: "Current agent turn" },
  ])(
    "selects $option explicitly without requiring a repository",
    async ({ option, turnId, label }) => {
      const { changed } = setup(DEFAULT_DIFF_COMPARISON, {
        repositoryRoot: false,
        compact: true,
        turns: [
          { id: "turn-2", label: "Turn 2 · Fix parser", finished: true },
          { id: "current", label: "Current agent turn", finished: false },
        ],
      });
      await chooseComparison("Turn");
      expect(screen.getByRole("dialog", { name: "Choose agent turn" })).toBeInTheDocument();
      expect(changed).not.toHaveBeenCalled();
      await chooseOption("Agent turn", option);
      fireEvent.click(screen.getByRole("button", { name: "Compare" }));
      expect(changed).toHaveBeenCalledExactlyOnceWith({
        ...DEFAULT_DIFF_COMPARISON,
        source: "last-turn",
        turnId,
      });
      expect(screen.getByRole("button", { name: "Diff comparison" })).toHaveTextContent("Turn");
      const trigger = screen.getByRole("button", { name: "Diff comparison" });
      await userEvent.hover(trigger);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        label === "Last agent turn" ? "Last completed agent turn" : label,
      );
      await userEvent.unhover(trigger);
      expect(
        screen.queryByText("Recorded agent edits · captured coverage"),
      ).not.toBeInTheDocument();
      await chooseComparison("Chat");
      expect(changed).toHaveBeenLastCalledWith({
        ...DEFAULT_DIFF_COMPARISON,
        source: "agent",
        turnId: undefined,
      });
    },
  );
});
