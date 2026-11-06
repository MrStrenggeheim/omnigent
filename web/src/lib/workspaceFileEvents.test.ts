import { describe, expect, it } from "vitest";
import { reconcileWorkspaceFilePath } from "./workspaceFileEvents";

describe("reconcileWorkspaceFilePath", () => {
  it("moves descendants while preserving similarly named siblings", () => {
    const changes = { moves: [{ source: "/repo/src", destination: "/repo/lib" }], removed: [] };
    expect(reconcileWorkspaceFilePath("/repo/src/a.ts", changes)).toBe("/repo/lib/a.ts");
    expect(reconcileWorkspaceFilePath("/repo/src-old/a.ts", changes)).toBe("/repo/src-old/a.ts");
  });

  it("closes deleted descendants and chooses the most specific move", () => {
    const changes = {
      moves: [
        { source: "src", destination: "lib" },
        { source: "src/nested", destination: "other" },
      ],
      removed: ["deleted"],
    };
    expect(reconcileWorkspaceFilePath("deleted/a.ts", changes)).toBeNull();
    expect(reconcileWorkspaceFilePath("deleted-old/a.ts", changes)).toBe("deleted-old/a.ts");
    expect(reconcileWorkspaceFilePath("src/nested/a.ts", changes)).toBe("other/a.ts");
    expect(reconcileWorkspaceFilePath("src", changes)).toBe("lib");
  });
});
