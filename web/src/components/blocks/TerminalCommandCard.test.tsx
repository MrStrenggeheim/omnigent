import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TerminalCommandCard } from "./TerminalCommandCard";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("TerminalCommandCard", () => {
  it("kind='input' renders the command text with a $ prefix", () => {
    render(<TerminalCommandCard kind="input" input="pwd" stdout={null} stderr={null} />);
    const card = screen.getByTestId("terminal-command-card");
    expect(card.getAttribute("data-terminal-kind")).toBe("input");
    expect(screen.getByText("pwd")).toBeDefined();
    expect(screen.getByText("$")).toBeDefined();
  });

  it("kind='input' with no text renders without crashing", () => {
    render(<TerminalCommandCard kind="input" input={null} stdout={null} stderr={null} />);
    const card = screen.getByTestId("terminal-command-card");
    expect(card.getAttribute("data-terminal-kind")).toBe("input");
  });

  it("kind='output' with no stdout/stderr renders '(no output)' and no collapsible", () => {
    const { container } = render(
      <TerminalCommandCard kind="output" input={null} stdout={null} stderr={null} />,
    );
    expect(screen.getByTestId("terminal-command-card").getAttribute("data-terminal-kind")).toBe(
      "output",
    );
    expect(screen.getByText("(no output)")).toBeDefined();
    expect(container.querySelector('[data-slot="collapsible-trigger"]')).toBeNull();
  });

  it("kind='output' with stdout renders collapsible; click reveals stdout panel", () => {
    const { container } = render(
      <TerminalCommandCard kind="output" input={null} stdout="/home/user" stderr={null} />,
    );
    const trigger = container.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("data-state")).toBe("closed");

    fireEvent.click(trigger!);

    expect(trigger!.getAttribute("data-state")).toBe("open");
    expect(screen.getAllByText("stdout").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText((_, node) => Boolean(node?.textContent?.includes("/home/user"))).length,
    ).toBeGreaterThan(0);
  });

  it("kind='output' with stderr renders stderr panel", () => {
    const { container } = render(
      <TerminalCommandCard kind="output" input={null} stdout={null} stderr="command not found" />,
    );
    const trigger = container.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);
    expect(screen.getAllByText("stderr").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText((_, node) => Boolean(node?.textContent?.includes("command not found")))
        .length,
    ).toBeGreaterThan(0);
  });

  it("keeps command input and combined stdout/stderr wrapping independent and remembered", () => {
    const cards = (
      <>
        <TerminalCommandCard kind="input" input="long command" stdout={null} stderr={null} />
        <TerminalCommandCard
          kind="output"
          input={null}
          stdout="standard output"
          stderr="error output"
        />
      </>
    );
    const { container, unmount } = render(cards);
    fireEvent.click(screen.getByRole("button", { name: "output" }));
    const inputToggle = screen.getByRole("button", { name: "Toggle command input word wrap" });
    const outputToggles = screen.getAllByRole("button", {
      name: "Toggle command output word wrap",
    });
    const command = screen.getByText("long command");
    const outputPanels = Array.from(container.querySelectorAll("pre"));
    expect(outputPanels).toHaveLength(2);
    expect(command.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(command.classList.contains("wrap-anywhere")).toBe(true);
    expect(outputPanels.every((panel) => panel.classList.contains("whitespace-pre-wrap"))).toBe(
      true,
    );

    fireEvent.click(inputToggle);
    expect(inputToggle.getAttribute("aria-pressed")).toBe("false");
    expect(command.classList.contains("whitespace-pre")).toBe(true);
    expect(outputToggles.every((toggle) => toggle.getAttribute("aria-pressed") === "true")).toBe(
      true,
    );

    fireEvent.click(outputToggles[1]);
    expect(outputToggles.every((toggle) => toggle.getAttribute("aria-pressed") === "false")).toBe(
      true,
    );
    expect(outputPanels.every((panel) => !panel.classList.contains("whitespace-pre-wrap"))).toBe(
      true,
    );
    expect(inputToggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(inputToggle);
    expect(outputToggles.every((toggle) => toggle.getAttribute("aria-pressed") === "false")).toBe(
      true,
    );
    expect(localStorage.getItem("omnigent:wrap:chat")).toBeNull();
    unmount();
    render(cards);
    fireEvent.click(screen.getByRole("button", { name: "output" }));
    expect(
      screen
        .getByRole("button", { name: "Toggle command input word wrap" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getAllByRole("button", { name: "Toggle command output word wrap" })
        .every((toggle) => toggle.getAttribute("aria-pressed") === "false"),
    ).toBe(true);
  });
});
