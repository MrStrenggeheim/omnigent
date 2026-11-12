import { describe, expect, it } from "vitest";
import { scrollbarGeometry } from "./overlay-scrollbar";

describe("shared scrollbar geometry", () => {
  it.each([
    [0, 0, 0],
    [200, 800, -8],
    [200, 0, 192],
  ])("ignores unmeasurable layout %j", (viewport, content, track) => {
    expect(scrollbarGeometry(viewport, content, track)).toEqual({ range: 0, thumb: 0, travel: 0 });
  });

  it("keeps a draggable thumb in a short generic viewport", () => {
    expect(scrollbarGeometry(40, 400, 32, 16)).toEqual({ range: 360, thumb: 16, travel: 16 });
  });
});
