// Skill guidance must retain readable text on the canonical light tooltip surface.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillPills } from "./SkillPills";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(cleanup);

const SKILLS = [
  {
    name: "cross-review",
    description: "Verify an implementer's diff with an independent sub-agent.",
  },
  { name: "fanout", description: "Run the same prompt across several sub-agents." },
];

function renderPills(onPick = vi.fn()) {
  // delayDuration 0: the bubble mounts on the first hover/focus, no timers to
  // advance.
  render(
    <TooltipProvider delayDuration={0}>
      <SkillPills skills={SKILLS} onPick={onPick} />
    </TooltipProvider>,
  );
  return onPick;
}

/** The open bubble's own element (radix also mounts a visually-hidden copy). */
function bubble(): HTMLElement {
  const els = document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]');
  expect(els.length).toBeGreaterThan(0);
  return els[0];
}

describe("SkillPills", () => {
  it("renders one pill per skill and hands the bare name to onPick", () => {
    const onPick = renderPills();
    expect(screen.getByTestId("skill-pill-cross-review").textContent).toBe("/cross-review");
    expect(screen.getByTestId("skill-pill-fanout").textContent).toBe("/fanout");
    fireEvent.click(screen.getByTestId("skill-pill-cross-review"));
    // Bare name, no leading slash — the caller prefills the composer with it.
    expect(onPick).toHaveBeenCalledWith("cross-review");
  });

  it("renders nothing when the agent bundles no skills", () => {
    render(
      <TooltipProvider>
        <SkillPills skills={[]} onPick={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId("skill-pills")).toBeNull();
  });

  it("shows the name and description once the pill is focused", () => {
    renderPills();
    expect(screen.queryByText(SKILLS[0].description)).toBeNull();
    fireEvent.focus(screen.getByTestId("skill-pill-cross-review"));
    expect(bubble().textContent).toContain("/cross-review");
    expect(bubble().textContent).toContain(SKILLS[0].description);
  });

  it("keeps readable text on the canonical light tooltip surface", () => {
    renderPills();
    fireEvent.focus(screen.getByTestId("skill-pill-cross-review"));
    expect(bubble()).toHaveStyle({ backgroundColor: "#fff", color: "#30303a" });
  });

  it("does not fall back to the inverted chip surface", () => {
    renderPills();
    fireEvent.focus(screen.getByTestId("skill-pill-cross-review"));
    // bg-neutral-900 is the tooltip default this bubble opts out of. If it ever
    // reappears here, the dark description text is back on a near-black box.
    expect(bubble().className).not.toMatch(/(^|\s)bg-neutral-\d+(\s|$)/);
  });

  it("keeps the description dimmed for hierarchy", () => {
    renderPills();
    fireEvent.focus(screen.getByTestId("skill-pill-cross-review"));
    const desc = screen
      .getAllByText(SKILLS[0].description)
      .find((el) => el.tagName === "P" && el.closest('[data-slot="tooltip-content"]'));
    expect(desc).toBeTruthy();
    // Legible on the card in both themes: 4.83:1 in light, 6.54:1 in dark.
    expect(desc?.className).toContain("text-muted-foreground");
  });
});
