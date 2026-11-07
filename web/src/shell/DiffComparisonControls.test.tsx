import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DIFF_COMPARISON,
  DiffComparisonControls,
  type DiffComparison,
} from "./DiffComparisonControls";

afterEach(cleanup);

function setup(initial: DiffComparison = DEFAULT_DIFF_COMPARISON) {
  const changed = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <DiffComparisonControls
        value={value}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return changed;
}

async function chooseComparison(label: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Diff comparison" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("DiffComparisonControls", () => {
  it("defaults to HEAD against the working tree", () => {
    const changed = setup();
    expect(screen.getByRole("combobox", { name: "Diff comparison" })).toHaveTextContent(
      "Git working tree",
    );
    expect(screen.getByText("HEAD → working tree")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });

  it("compares a trimmed commit revision against its parent only after submission", async () => {
    const changed = setup();
    await chooseComparison("Commit");
    expect(changed).toHaveBeenLastCalledWith({ source: "commit", base: "HEAD^", target: "HEAD" });
    expect(screen.queryByRole("textbox", { name: "Base revision" })).not.toBeInTheDocument();
    changed.mockClear();
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
  });

  it("forwards both range revisions and resets them when returning to the working tree", async () => {
    const changed = setup();
    await chooseComparison("Commit range");
    fireEvent.change(screen.getByRole("textbox", { name: "Base revision" }), {
      target: { value: " release/v1 " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Target revision" }), {
      target: { value: " feature/topic " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(changed).toHaveBeenLastCalledWith({
      source: "range",
      base: "release/v1",
      target: "feature/topic",
    });
    await chooseComparison("Git working tree");
    expect(changed).toHaveBeenLastCalledWith(DEFAULT_DIFF_COMPARISON);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each([
    { source: "commit" as const, field: "Commit revision" },
    { source: "range" as const, field: "Base revision" },
    { source: "range" as const, field: "Target revision" },
  ])("disables Compare for a blank $field", ({ source, field }) => {
    const changed = setup({ ...DEFAULT_DIFF_COMPARISON, source });
    fireEvent.change(screen.getByRole("textbox", { name: field }), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(changed).not.toHaveBeenCalled();
  });

  it.each([
    { label: "Agent changes · session", source: "agent" },
    { label: "Last agent turn", source: "last-turn" },
  ])("selects $label independently of Git revisions", async ({ label, source }) => {
    const changed = setup();
    await chooseComparison(label);
    expect(changed).toHaveBeenLastCalledWith({ ...DEFAULT_DIFF_COMPARISON, source });
    expect(screen.getByText("Observed agent file edits")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
