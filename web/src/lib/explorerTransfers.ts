import {
  bytesToBase64,
  childPath,
  downloadBlob,
  filesystemOperation,
  type UploadItem,
} from "./explorerOperations";

/* eslint-disable no-await-in-loop -- Upload offsets and archive chunks depend on the previous response. */

export interface ExplorerTransfer {
  conversationId: string;
  kind: "upload" | "download";
  name: string;
  completed: number;
  total: number;
  status: "running" | "cancelling" | "completed" | "cancelled" | "failed";
  message: string | null;
}

interface ActiveTransfer {
  controller: AbortController;
  value: ExplorerTransfer;
}
const transfers = new Map<string, ActiveTransfer>();
const listeners = new Set<() => void>();
let snapshot: ExplorerTransfer[] = [];

function publish(): void {
  snapshot = [...transfers.values()].map((transfer) => transfer.value);
  for (const listener of listeners) listener();
}
export function subscribeExplorerTransfers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getExplorerTransfers(): ExplorerTransfer[] {
  return snapshot;
}
export function transferIsActive(transfer: ExplorerTransfer): boolean {
  return transfer.status === "running" || transfer.status === "cancelling";
}
export function cancelExplorerTransfer(conversationId: string): void {
  const transfer = transfers.get(conversationId);
  if (!transfer || !transferIsActive(transfer.value)) return;
  transfer.value = {
    ...transfer.value,
    status: "cancelling",
    message: "Cancelling and cleaning up…",
  };
  transfer.controller.abort();
  publish();
}
export function dismissExplorerTransfer(conversationId: string): void {
  const transfer = transfers.get(conversationId);
  if (transfer && !transferIsActive(transfer.value)) {
    transfers.delete(conversationId);
    publish();
  }
}

function startTransfer(
  initial: Pick<ExplorerTransfer, "conversationId" | "kind" | "name" | "total">,
  execute: (
    signal: AbortSignal,
    progress: (name: string, completed: number, total: number) => void,
  ) => Promise<void>,
): void {
  const previous = transfers.get(initial.conversationId);
  if (previous && transferIsActive(previous.value))
    throw new Error("A file transfer is already running in this session.");
  const transfer: ActiveTransfer = {
    controller: new AbortController(),
    value: { ...initial, completed: 0, status: "running", message: null },
  };
  transfers.set(initial.conversationId, transfer);
  publish();
  const progress = (name: string, completed: number, total: number) => {
    transfer.value = { ...transfer.value, name, completed, total };
    publish();
  };
  void (async () => {
    try {
      await execute(transfer.controller.signal, progress);
      transfer.value = {
        ...transfer.value,
        status: "completed",
        message: initial.kind === "upload" ? "Upload complete" : "Download complete",
      };
    } catch (cause) {
      const cancelled =
        typeof cause === "object" &&
        cause !== null &&
        "name" in cause &&
        cause.name === "AbortError";
      transfer.value = {
        ...transfer.value,
        status: cancelled ? "cancelled" : "failed",
        message: cancelled
          ? initial.kind === "upload"
            ? "Upload cancelled. Completed files are kept."
            : "Download cancelled."
          : cause instanceof Error
            ? cause.message
            : String(cause),
      };
    }
    publish();
  })();
}

export interface ExplorerUpload {
  files: UploadItem[];
  directories: string[];
  destination: string;
}

/** Transfer ownership belongs to this store, so changing views never cancels it. */
export function startExplorerUpload(
  conversationId: string,
  upload: ExplorerUpload,
  overwrite: boolean,
  refresh: () => Promise<void>,
): void {
  if (upload.files.some((item) => item.file.size > 1024 ** 3))
    throw new Error("Each uploaded file must be at most 1 GiB.");
  const pending: ExplorerUpload = {
    ...upload,
    files: [...upload.files],
    directories: [...upload.directories],
  };
  const total = pending.files.reduce((sum, item) => sum + item.file.size, 0);
  startTransfer(
    { conversationId, kind: "upload", name: `${pending.files.length} file(s)`, total },
    async (signal, progress) => {
      const checkCancelled = () => {
        if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      };
      let completed = 0;
      try {
        for (const directory of pending.directories) {
          checkCancelled();
          await filesystemOperation(
            conversationId,
            { operation: "mkdir", path: childPath(pending.destination, directory), exist_ok: true },
            signal,
          );
        }
        for (const item of pending.files) {
          checkCancelled();
          const path = childPath(pending.destination, item.path);
          progress(item.path, completed, total);
          let uploadId: string | undefined;
          try {
            // Obtain the staging id even after cancellation, so cleanup can name it.
            const begun = await filesystemOperation(conversationId, {
              operation: "upload_begin",
              path,
              size: item.file.size,
              overwrite,
            });
            uploadId = begun.upload_id;
            if (!uploadId) throw new Error("The host did not start the upload.");
            const chunkSize = Math.max(1, Math.min(begun.chunk_size ?? 65536, 65536));
            for (let offset = 0; offset < item.file.size; offset += chunkSize) {
              checkCancelled();
              const bytes = new Uint8Array(
                await item.file.slice(offset, offset + chunkSize).arrayBuffer(),
              );
              await filesystemOperation(
                conversationId,
                {
                  operation: "upload_chunk",
                  path,
                  upload_id: uploadId,
                  offset,
                  content_base64: bytesToBase64(bytes),
                },
                signal,
              );
              progress(item.path, completed + offset + bytes.length, total);
            }
            checkCancelled();
            await filesystemOperation(
              conversationId,
              { operation: "upload_finish", path, upload_id: uploadId },
              signal,
            );
            completed += item.file.size;
          } catch (cause) {
            if (uploadId) {
              try {
                await filesystemOperation(conversationId, {
                  operation: "upload_cancel",
                  path,
                  upload_id: uploadId,
                });
              } catch (cleanupError) {
                throw new Error(
                  `${cause instanceof Error ? cause.message : cause}; upload cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`,
                  { cause: cleanupError },
                );
              }
            }
            throw cause;
          }
        }
      } finally {
        await refresh();
      }
    },
  );
}

export function startExplorerArchive(conversationId: string, selection: string[]): void {
  const paths = [...selection];
  startTransfer(
    { conversationId, kind: "download", name: "Preparing ZIP…", total: 1 },
    async (signal, progress) => {
      let archiveId: string | undefined;
      try {
        // Keep the creation response to clean up its id if cancellation arrives.
        const begun = await filesystemOperation(conversationId, {
          operation: "archive_begin",
          paths,
        });
        archiveId = begun.archive_id;
        if (!archiveId || begun.size === undefined)
          throw new Error("The host did not create an archive.");
        const parts: BlobPart[] = [];
        let offset = 0;
        while (offset < begun.size) {
          const part = await filesystemOperation(
            conversationId,
            { operation: "archive_chunk", paths, archive_id: archiveId, offset },
            signal,
          );
          const decoded = atob(part.content_base64 ?? "");
          if (!decoded.length) throw new Error("The archive download stopped before completion.");
          parts.push(Uint8Array.from(decoded, (char) => char.charCodeAt(0)));
          offset += decoded.length;
          progress(begun.filename ?? "files.zip", offset, begun.size);
        }
        if (signal.aborted) throw new DOMException("Download cancelled", "AbortError");
        downloadBlob(new Blob(parts, { type: "application/zip" }), begun.filename ?? "files.zip");
      } finally {
        if (archiveId)
          await filesystemOperation(conversationId, {
            operation: "archive_cancel",
            paths,
            archive_id: archiveId,
          });
      }
    },
  );
}
