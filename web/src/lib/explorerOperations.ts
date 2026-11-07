import { authenticatedFetch } from "@/lib/identity";
import { triggerBrowserDownload } from "@/hooks/useFileContent";

/* eslint-disable no-await-in-loop -- Directory readers return batches in order and nested reads depend on their parents. */

export interface ExplorerEntry {
  path: string;
  directory: boolean;
}

export interface TrashEntry {
  id: string;
  original_path: string;
  trashed_at: string;
  type: string;
}

export interface FilesystemOperationResult {
  affected_paths?: string[];
  moved?: { source: string; destination: string }[];
  items?: TrashEntry[];
  content_base64?: string;
  filename?: string;
  mime_type?: string;
  upload_id?: string;
  chunk_size?: number;
  archive_id?: string;
  size?: number;
  eof?: boolean;
}

export class FilesystemOperationError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FilesystemOperationError";
    this.status = status;
  }
}

export type { WorkspaceFilesChanged } from "./workspaceFileEvents";

export function absoluteExplorerPath(root: string, path: string): string {
  return /^([A-Za-z]:)?[\\/]/.test(path) ? path : childPath(root, path);
}

export function isExplorerInternalPath(path: string): boolean {
  return path
    .split("/")
    .some(
      (part) =>
        part === ".omnigent-trash" ||
        part === ".omnigent-transfers" ||
        part.startsWith(".omnigent-upload-"),
    );
}

export async function filesystemOperation(
  conversationId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<FilesystemOperationResult> {
  const response = await authenticatedFetch(
    `/v1/sessions/${encodeURIComponent(conversationId)}/resources/environments/default/filesystem-operations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) {
    throw new FilesystemOperationError(
      (typeof result?.detail === "string" ? result.detail : result?.error?.message) ||
        (typeof result?.error === "string" ? result.error : null) ||
        `File operation failed (${response.status})`,
      response.status,
    );
  }
  return result;
}

export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === 0 ? "/" : slash > 0 ? path.slice(0, slash) : "";
}

export function basename(path: string): string {
  return path.replace(/\/$/, "").split("/").at(-1) ?? path;
}

export function childPath(parent: string, child: string): string {
  return parent ? `${parent.replace(/\/$/, "")}/${child}` : child;
}

/** A parent selection already includes its children during a recursive operation. */
export function distinctRoots(entries: ExplorerEntry[]): ExplorerEntry[] {
  return entries.filter(
    (entry, index) =>
      entries.findIndex((other) => other.path === entry.path) === index &&
      !entries.some(
        (other) => other.directory && entry.path.startsWith(`${other.path.replace(/\/$/, "")}/`),
      ),
  );
}

export function selectionRange(
  entries: ExplorerEntry[],
  anchor: string | null,
  target: ExplorerEntry,
): ExplorerEntry[] {
  const start = entries.findIndex((entry) => entry.path === anchor);
  const end = entries.findIndex((entry) => entry.path === target.path);
  return start < 0 || end < 0
    ? [target]
    : entries.slice(Math.min(start, end), Math.max(start, end) + 1);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function downloadBase64(content: string, filename: string, mimeType: string): void {
  const decoded = atob(content);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: mimeType }), filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  triggerBrowserDownload(blob, filename);
}

export interface UploadItem {
  file: File;
  path: string;
}

interface DroppedEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file: (success: (file: File) => void, failure: (error: DOMException) => void) => void;
  createReader: () => {
    readEntries: (
      success: (entries: DroppedEntry[]) => void,
      failure: (error: DOMException) => void,
    ) => void;
  };
}

export async function droppedUploads(transfer: DataTransfer): Promise<{
  files: UploadItem[];
  directories: string[];
}> {
  const files: UploadItem[] = [];
  const directories: string[] = [];
  const entries = Array.from(transfer.items ?? []).map((item) => {
    const entryItem = item as unknown as { webkitGetAsEntry?: () => DroppedEntry | null };
    return entryItem.webkitGetAsEntry?.() ?? null;
  });
  async function visit(entry: DroppedEntry, parent: string): Promise<void> {
    const path = childPath(parent, entry.name);
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
      });
      files.push({ file, path });
    } else if (entry.isDirectory) {
      directories.push(path);
      const reader = entry.createReader();
      for (;;) {
        const children = await new Promise<DroppedEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
        if (!children.length) break;
        for (const child of children) await visit(child, path);
      }
    }
  }
  if (entries.some(Boolean)) {
    for (const entry of entries) if (entry) await visit(entry, "");
  } else {
    for (const file of Array.from(transfer.files))
      files.push({ file, path: file.webkitRelativePath || file.name });
  }
  return { files, directories };
}
