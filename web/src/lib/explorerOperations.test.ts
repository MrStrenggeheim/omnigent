import { describe, expect, it, vi } from "vitest";
import {
  absoluteExplorerPath,
  bytesToBase64,
  childPath,
  distinctRoots,
  droppedUploads,
  parentPath,
  selectionRange,
} from "./explorerOperations";

describe("Explorer operation paths and selection", () => {
  it("keeps host-absolute locations intact and resolves workspace-relative files", () => {
    expect(absoluteExplorerPath("/work", "src/a.py")).toBe("/work/src/a.py");
    expect(absoluteExplorerPath("/work", "/tmp/a.py")).toBe("/tmp/a.py");
    expect(childPath("/", "a.py")).toBe("/a.py");
    expect(parentPath("/a.py")).toBe("/");
    expect(parentPath("a.py")).toBe("");
  });

  it("deduplicates descendants without confusing sibling path prefixes", () => {
    expect(
      distinctRoots([
        { path: "src", directory: true },
        { path: "src/a.py", directory: false },
        { path: "src-old/a.py", directory: false },
        { path: "src", directory: true },
      ]),
    ).toEqual([
      { path: "src", directory: true },
      { path: "src-old/a.py", directory: false },
    ]);
  });

  it("selects a backwards range and falls back when the anchor disappeared", () => {
    const entries = ["a", "b", "c"].map((path) => ({ path, directory: false }));
    expect(selectionRange(entries, "c", entries[0])).toEqual(entries);
    expect(selectionRange(entries, "gone", entries[1])).toEqual([entries[1]]);
  });

  it("encodes arbitrary binary bytes across conversion batches", () => {
    const bytes = new Uint8Array(70000).map((_, index) => index % 256);
    expect(Uint8Array.from(atob(bytesToBase64(bytes)), (char) => char.charCodeAt(0))).toEqual(
      bytes,
    );
  });
});

describe("directory drops", () => {
  it("drains every browser directory batch and preserves empty folders", async () => {
    const file = new File(["hello"], "note.txt");
    const batches = [
      [
        {
          name: "empty",
          isFile: false,
          isDirectory: true,
          createReader: () => ({
            readEntries: (resolve: (entries: unknown[]) => void) => resolve([]),
          }),
        },
      ],
      [
        {
          name: "note.txt",
          isFile: true,
          isDirectory: false,
          file: (resolve: (value: File) => void) => resolve(file),
        },
      ],
      [],
    ];
    const readEntries = vi.fn((resolve: (entries: unknown[]) => void) =>
      resolve(batches.shift() ?? []),
    );
    const transfer = {
      items: [
        {
          webkitGetAsEntry: () => ({
            name: "folder",
            isDirectory: true,
            isFile: false,
            createReader: () => ({ readEntries }),
          }),
        },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(await droppedUploads(transfer)).toEqual({
      files: [{ file, path: "folder/note.txt" }],
      directories: ["folder", "folder/empty"],
    });
    expect(readEntries).toHaveBeenCalledTimes(3);
  });

  it("surfaces directory reader errors", async () => {
    const transfer = {
      items: [
        {
          webkitGetAsEntry: () => ({
            name: "folder",
            isDirectory: true,
            createReader: () => ({
              readEntries: (_resolve: unknown, reject: (error: DOMException) => void) =>
                reject(new DOMException("Access denied")),
            }),
          }),
        },
      ],
    } as unknown as DataTransfer;
    await expect(droppedUploads(transfer)).rejects.toThrow("Access denied");
  });
});
