import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  FilePlusIcon,
  FolderPlusIcon,
  ListCollapseIcon,
  MoreHorizontalIcon,
  XIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CopyPathButton } from "./CopyPathButton";
import { FileDownloadButton } from "./FileDownloadButton";
import { formatBytes } from "./fileStatusUtils";
import { useFileDropTarget } from "@/hooks/useFileDropTarget";
import { FileDropOverlay } from "@/components/FileDropOverlay";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/clipboard";
import {
  absoluteExplorerPath,
  basename,
  childPath,
  distinctRoots,
  droppedUploads,
  filesystemOperation,
  FilesystemOperationError,
  parentPath,
  selectionRange,
  type ExplorerEntry,
  type FilesystemOperationResult,
  type TrashEntry,
  type UploadItem,
} from "@/lib/explorerOperations";
import { joinBrowseLocation, relativizeToWorkspace } from "@/hooks/useWorkspaceChangedFiles";
import { FileViewerContext } from "./FileViewerContext";
import {
  getExplorerTransfers,
  startExplorerArchive,
  startExplorerUpload,
  subscribeExplorerTransfers,
  transferIsActive,
} from "@/lib/explorerTransfers";
import {
  RevealBaseContext,
  revealInFileManager,
  revealLabel,
  useRevealTarget,
} from "./RevealInFileManager";

const DRAG_TYPE = "application/x-omnigent-files";
interface ExplorerClipboard {
  conversationId: string;
  hostId: string | null;
  entries: ExplorerEntry[];
  cut: boolean;
}
let clipboard: ExplorerClipboard | null = null;

interface TreeControls {
  entries: ExplorerEntry[];
  navigate?: (path: string, key: string) => string | null;
  collapse?: () => void;
  reveal?: (path: string) => void;
}
interface ExplorerContextValue {
  conversationId: string | undefined;
  base: string;
  writable: boolean;
  selected: Map<string, ExplorerEntry>;
  focused: string | null;
  registerTree: (controls: TreeControls) => () => void;
  openMenu: (entry: ExplorerEntry, x: number, y: number) => void;
  select: (entry: ExplorerEntry, additive: boolean, range: boolean) => void;
  setFocused: (path: string) => void;
  startDrag: (entry: ExplorerEntry, transfer: DataTransfer) => void;
  drop: (entry: ExplorerEntry, transfer: DataTransfer, copy: boolean) => void;
  download: (entries: ExplorerEntry[]) => Promise<void>;
  newItem: (directory: boolean, parent?: string) => void;
  search: (path: string) => void;
  collapse: () => void;
  reveal: () => void;
  menu: (target: ExplorerEntry) => ReactNode;
  feedback: ReactNode;
  chooseUpload: (directory: boolean, path?: string) => void;
  busy: boolean;
  isDragActive: boolean;
}
const ExplorerContext = createContext<ExplorerContextValue | null>(null);

function RevealFileMenuItem({ entry }: { entry: ExplorerEntry }) {
  const target = useRevealTarget(entry.path);
  return target ? (
    <DropdownMenuItem onSelect={() => revealInFileManager(target)}>
      {revealLabel(entry.directory)}
    </DropdownMenuItem>
  ) : null;
}

export function useExplorerTree(controls: TreeControls): void {
  const registerTree = useContext(ExplorerContext)?.registerTree;
  useEffect(() => registerTree?.(controls), [registerTree, controls]);
}

export function useExplorerRow(path: string, directory: boolean, deleted = false) {
  const ctx = useContext(ExplorerContext);
  const revealBase = useContext(RevealBaseContext);
  const canonical = joinBrowseLocation(ctx?.base ?? revealBase, path);
  const entry = { path: canonical, directory };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  useEffect(() => {
    if (!ctx?.isDragActive) {
      clearTimeout(timer.current ?? undefined);
      timer.current = null;
    }
  }, [ctx?.isDragActive]);
  if (!ctx || deleted)
    return { selected: false, props: {} as HTMLAttributes<HTMLDivElement>, path: canonical };
  const props: HTMLAttributes<HTMLDivElement> & {
    "data-explorer-entry": string;
    "data-directory": string;
  } = {
    "data-explorer-entry": canonical,
    "data-directory": String(directory),
    role: "treeitem",
    "aria-selected": ctx.selected.has(canonical),
    tabIndex: ctx.focused === canonical ? 0 : -1,
    draggable: ctx.writable,
    onFocus: () => ctx.setFocused(canonical),
    onClickCapture: (event) => {
      if ((event.target as HTMLElement).closest("[data-explorer-action]")) return;
      const button = (event.target as HTMLElement).closest("button");
      if (button && button !== event.currentTarget.querySelector("button")) return;
      ctx.select(entry, event.metaKey || event.ctrlKey, event.shiftKey);
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
      }
    },
    onContextMenu: (event) => {
      event.preventDefault();
      event.stopPropagation();
      const box = event.currentTarget.getBoundingClientRect();
      ctx.openMenu(entry, event.clientX || box.left, event.clientY || box.bottom);
    },
    onDragStart: (event) => {
      event.stopPropagation();
      ctx.startDrag(entry, event.dataTransfer);
    },
    onDragOver:
      directory && ctx.writable
        ? (event) => {
            if (
              !Array.from(event.dataTransfer.types ?? []).some(
                (type) => type === "Files" || type === DRAG_TYPE,
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.dataset.dropTarget = "true";
            event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? "copy" : "move";
            const toggle = event.currentTarget.querySelector<HTMLButtonElement>(
              "button[aria-expanded='false']",
            );
            if (toggle && !timer.current)
              timer.current = setTimeout(() => {
                toggle.click();
                timer.current = null;
              }, 650);
          }
        : undefined,
    onDragLeave: (event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      delete event.currentTarget.dataset.dropTarget;
      clearTimeout(timer.current ?? undefined);
      timer.current = null;
    },
    onDragEnd: (event) => {
      delete event.currentTarget.dataset.dropTarget;
      clearTimeout(timer.current ?? undefined);
      timer.current = null;
    },
  };
  return { selected: ctx.selected.has(canonical), props, path: canonical };
}

interface ActionDialog {
  kind: "new-file" | "new-folder" | "rename" | "move" | "duplicate" | "trash";
  entries: ExplorerEntry[];
  parent: string;
}
interface PendingUpload {
  files: UploadItem[];
  directories: string[];
  destination: string;
}

export function ExplorerActionsProvider({
  children,
  conversationId,
  base,
  workspaceRoot,
  hostId,
  writable,
  onRefresh,
  onRevealFile,
}: {
  children: ReactNode;
  conversationId: string | undefined;
  base: string;
  workspaceRoot: string | null;
  hostId: string | null;
  writable: boolean;
  onRefresh: () => Promise<void>;
  onRevealFile?: (path: string) => void;
}) {
  const queryClient = useContext(QueryClientContext);
  const viewer = useContext(FileViewerContext);
  const [selected, setSelected] = useState(new Map<string, ExplorerEntry>());
  const [focused, setFocused] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const tree = useRef<TreeControls>({ entries: [] });
  const root = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<HTMLDivElement | null>(null);
  const setRoot = useCallback((element: HTMLDivElement | null) => {
    root.current = element;
    setDropTarget(element);
  }, []);
  const [point, setPoint] = useState<{ entry: ExplorerEntry; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [value, setValue] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setBusy] = useState(false);
  const transfers = useSyncExternalStore(subscribeExplorerTransfers, getExplorerTransfers);
  const busy =
    localBusy ||
    transfers.some(
      (transfer) => transfer.conversationId === conversationId && transferIsActive(transfer),
    );
  const busyRef = useRef(false);
  const [trash, setTrash] = useState<TrashEntry[] | null>(null);
  const [upload, setUpload] = useState<PendingUpload | null>(null);
  const [pasteConflict, setPasteConflict] = useState<{
    clipboard: ExplorerClipboard;
    destination: string;
  } | null>(null);
  const uploadDestination = useRef(base);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const registerTree = useCallback(
    (controls: TreeControls) => {
      tree.current = {
        ...controls,
        entries: controls.entries.map((entry) => ({
          ...entry,
          path: joinBrowseLocation(base, entry.path),
        })),
      };
      return () => {
        if (tree.current.navigate === controls.navigate) tree.current = { entries: [] };
      };
    },
    [base],
  );
  useEffect(() => {
    setSelected(new Map());
    setFocused(null);
    anchor.current = null;
  }, [conversationId, base]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (queryClient && conversationId) {
      await Promise.all(
        [
          "workspace-dir",
          "workspace-dir-listing",
          "workspace-all-files",
          "workspace-changed-files",
          "workspace-file-search",
          "file-content",
          "file-diff",
          "content-search-result",
        ].map((key) => queryClient.invalidateQueries({ queryKey: [key, conversationId] })),
      );
    }
    if (mounted.current) await onRefresh();
  }, [conversationId, onRefresh, queryClient]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    if (
      getExplorerTransfers().some(
        (transfer) => transfer.conversationId === conversationId && transferIsActive(transfer),
      )
    ) {
      setError("A file transfer is already running in this session.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const operation = async (body: Record<string, unknown>): Promise<FilesystemOperationResult> => {
    if (!conversationId) throw new Error("Open a session before managing files.");
    const result = await filesystemOperation(conversationId, body);
    if (body.operation !== "archive" && body.operation !== "trash_list") {
      window.dispatchEvent(
        new CustomEvent("omnigent:workspace-files-changed", {
          detail: {
            conversationId,
            moves: (result.moved ?? []).map((move) => ({
              source: relativizeToWorkspace(move.source, workspaceRoot),
              destination: relativizeToWorkspace(move.destination, workspaceRoot),
            })),
            removed:
              body.operation === "trash"
                ? (body.paths as string[]).map((path) => relativizeToWorkspace(path, workspaceRoot))
                : [],
          },
        }),
      );
      setSelected(new Map());
      await refresh();
    }
    return result;
  };
  const picked = (target: ExplorerEntry) =>
    distinctRoots(selected.has(target.path) ? [...selected.values()] : [target]);
  const destinationFor = (target: ExplorerEntry) =>
    target.directory ? target.path : parentPath(target.path);
  const search = (path: string) => {
    window.dispatchEvent(
      new CustomEvent("omnigent:open-content-search", {
        detail: { conversationId, location: path },
      }),
    );
  };
  const openDialog = (kind: ActionDialog["kind"], entries: ExplorerEntry[], parent = base) => {
    setError(null);
    setOverwrite(false);
    setValue(
      kind === "rename"
        ? basename(entries[0].path)
        : kind === "duplicate"
          ? `${basename(entries[0].path)}.copy`
          : kind === "move"
            ? parent
            : "",
    );
    setDialog({ kind, entries, parent });
  };
  const chooseUpload = (directory: boolean, path = base) => {
    uploadDestination.current = path;
    (directory ? folderInput : fileInput).current?.click();
  };
  const setClipboard = async (entries: ExplorerEntry[], cut: boolean) => {
    clipboard = {
      conversationId: conversationId ?? "",
      hostId,
      cut,
      entries: distinctRoots(entries).map((entry) => ({
        ...entry,
        path: workspaceRoot ? absoluteExplorerPath(workspaceRoot, entry.path) : entry.path,
      })),
    };
    await copyText(clipboard.entries.map((entry) => entry.path).join("\n"));
  };
  const paste = async (destination: string, clip = clipboard, overwriteExisting = false) => {
    if (!clip) throw new Error("Copy or cut files in the Explorer first.");
    if (clip.conversationId !== conversationId && (!hostId || hostId !== clip.hostId))
      throw new Error("Files can only be pasted on the same host.");
    const entries = clip.entries.map((entry) => {
      const source = workspaceRoot ? relativizeToWorkspace(entry.path, workspaceRoot) : entry.path;
      return { source, destination: childPath(destination, basename(entry.path)) };
    });
    try {
      await operation({
        operation: clip.cut ? "move" : "copy",
        entries,
        overwrite: overwriteExisting,
      });
    } catch (cause) {
      if (
        !overwriteExisting &&
        ((cause instanceof FilesystemOperationError && cause.status === 409) ||
          (cause instanceof Error && /already exists|file exists/i.test(cause.message)))
      ) {
        setPasteConflict({ clipboard: clip, destination });
        return;
      }
      throw cause;
    }
    if (clip.cut && clip === clipboard) clipboard = null;
  };
  const download = async (entries: ExplorerEntry[]) => {
    if (conversationId)
      startExplorerArchive(
        conversationId,
        distinctRoots(entries).map((entry) => entry.path),
      );
  };
  const loadTrash = async () => {
    const result = await operation({ operation: "trash_list", path: base });
    setTrash(result.items ?? []);
  };
  const menu = (target: ExplorerEntry) => {
    const entries = picked(target);
    const folder = destinationFor(target);
    return (
      <>
        <DropdownMenuItem
          disabled={!writable || busy}
          onSelect={() => openDialog("new-file", [], folder)}
        >
          New file…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!writable || busy}
          onSelect={() => openDialog("new-folder", [], folder)}
        >
          New folder…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => search(folder)}>Search in folder…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!writable || busy} onSelect={() => chooseUpload(false, folder)}>
          Upload files…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!writable || busy} onSelect={() => chooseUpload(true, folder)}>
          Upload folder…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => void run(() => download(entries))}>
          Download as ZIP
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!writable || busy || !target.path}
          onSelect={() => void run(() => setClipboard(entries, true))}
        >
          Cut
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy || !target.path}
          onSelect={() => void run(() => setClipboard(entries, false))}
        >
          Copy
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!writable || busy || !clipboard}
          onSelect={() => void run(() => paste(folder))}
        >
          Paste
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!writable || busy || entries.length !== 1 || !target.path}
          onSelect={() => openDialog("rename", entries)}
        >
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!writable || busy || !target.path}
          onSelect={() => openDialog("move", entries, folder)}
        >
          Move to…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!writable || busy || entries.length !== 1 || !target.path}
          onSelect={() => openDialog("duplicate", entries)}
        >
          Duplicate…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!writable || busy || !target.path}
          onSelect={() => openDialog("trash", entries)}
        >
          Move to trash…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void run(() =>
              copyText(
                workspaceRoot ? absoluteExplorerPath(workspaceRoot, target.path) : target.path,
              ),
            )
          }
        >
          Copy path
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run(() => copyText(target.path))}>
          Copy relative path
        </DropdownMenuItem>
        <RevealFileMenuItem entry={target} />
        <DropdownMenuItem disabled={!writable || busy} onSelect={() => void run(loadTrash)}>
          Restore deleted files…
        </DropdownMenuItem>
      </>
    );
  };

  const select = (entry: ExplorerEntry, additive: boolean, range: boolean) => {
    setFocused(entry.path);
    setSelected((previous) => {
      if (range)
        return new Map(
          selectionRange(tree.current.entries, anchor.current, entry).map((item) => [
            item.path,
            item,
          ]),
        );
      anchor.current = entry.path;
      if (!additive) return new Map([[entry.path, entry]]);
      const next = new Map(previous);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.set(entry.path, entry);
      return next;
    });
  };
  const openMenu = (entry: ExplorerEntry, x: number, y: number) => {
    if (!selected.has(entry.path)) {
      setSelected(new Map([[entry.path, entry]]));
      anchor.current = entry.path;
    }
    setFocused(entry.path);
    setPoint({ entry, x, y });
  };
  const startDrag = (entry: ExplorerEntry, transfer: DataTransfer) => {
    const clip: ExplorerClipboard = {
      conversationId: conversationId ?? "",
      hostId,
      cut: true,
      entries: picked(entry).map((item) => ({
        ...item,
        path: workspaceRoot ? absoluteExplorerPath(workspaceRoot, item.path) : item.path,
      })),
    };
    transfer.setData(DRAG_TYPE, JSON.stringify(clip));
    transfer.effectAllowed = "copyMove";
  };
  const drop = (entry: ExplorerEntry, transfer: DataTransfer, copy: boolean) => {
    const internal = transfer.getData(DRAG_TYPE);
    if (internal) {
      void run(async () => {
        const clip = JSON.parse(internal) as ExplorerClipboard;
        if (!Array.isArray(clip.entries)) throw new Error("Invalid file drop.");
        await paste(destinationFor(entry), { ...clip, cut: !copy });
      });
    } else {
      void run(async () => {
        const pending = await droppedUploads(transfer);
        setUpload({ ...pending, destination: destinationFor(entry) });
        setOverwrite(false);
      });
    }
  };

  const isDragActive = useFileDropTarget(writable ? dropTarget : null, () => {}, {
    additionalTypes: [DRAG_TYPE],
    capture: true,
    onDrop: (event) => {
      const folder = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-explorer-entry][data-directory=true]",
      );
      event.stopPropagation();
      drop(
        { path: folder?.dataset.explorerEntry ?? base, directory: true },
        event.dataTransfer!,
        event.ctrlKey || event.metaKey,
      );
    },
  });
  useEffect(() => {
    if (isDragActive) return;
    root.current
      ?.querySelectorAll<HTMLElement>("[data-drop-target]")
      .forEach((element) => delete element.dataset.dropTarget);
  }, [isDragActive]);

  const context: ExplorerContextValue = {
    conversationId,
    base,
    writable,
    selected,
    focused,
    registerTree,
    openMenu,
    select,
    setFocused,
    startDrag,
    drop,
    download,
    newItem: (directory, parent) =>
      openDialog(directory ? "new-folder" : "new-file", [], parent ?? base),
    search,
    collapse: () => tree.current.collapse?.(),
    reveal: () => {
      if (viewer?.activeFilePath) {
        if (onRevealFile) onRevealFile(viewer.activeFilePath);
        else tree.current.reveal?.(viewer.activeFilePath);
      }
    },
    menu,
    chooseUpload,
    busy,
    isDragActive,
    feedback: error && !dialog && !upload && !pasteConflict && trash === null && (
      <div role="alert" className="flex gap-2 border-t border-border p-2 text-xs text-destructive">
        <span className="min-w-0 flex-1 break-words">{error}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => setError(null)}
          aria-label="Dismiss file error"
        >
          <XIcon />
        </Button>
      </div>
    ),
  };

  const applyDialog = async () => {
    if (!dialog) return;
    if (dialog.kind === "trash")
      await operation({
        operation: "trash",
        path: base,
        paths: distinctRoots(dialog.entries).map((entry) => entry.path),
      });
    else if (dialog.kind === "new-file" || dialog.kind === "new-folder") {
      if (!value.trim() || value.includes("/") || value === "." || value === "..")
        throw new Error("Enter a single file or folder name.");
      const path = childPath(dialog.parent, value);
      await operation({ operation: dialog.kind === "new-folder" ? "mkdir" : "create_file", path });
    } else {
      if (!value.trim() && dialog.kind !== "move") throw new Error("Enter a destination.");
      if (dialog.kind !== "move" && (value.includes("/") || value === "." || value === ".."))
        throw new Error("Enter a single name; use Move to for another folder.");
      await operation({
        operation: dialog.kind === "duplicate" ? "copy" : "move",
        overwrite,
        entries: distinctRoots(dialog.entries).map((entry) => ({
          source: entry.path,
          destination:
            dialog.kind === "move"
              ? childPath(value === "/" ? "/" : value.replace(/\/$/, ""), basename(entry.path))
              : childPath(parentPath(entry.path), value),
        })),
      });
    }
    setDialog(null);
  };

  const startUpload = async () => {
    if (!upload || !conversationId) return;
    startExplorerUpload(conversationId, upload, overwrite, refresh);
    setUpload(null);
  };

  const dialogTitle = dialog
    ? {
        "new-file": "New file",
        "new-folder": "New folder",
        rename: "Rename",
        move: "Move to folder",
        duplicate: "Duplicate",
        trash: "Move to trash",
      }[dialog.kind]
    : "File operation";
  const onKeyDown: HTMLAttributes<HTMLDivElement>["onKeyDown"] = (event) => {
    if (
      (event.target as HTMLElement).closest(
        "input,textarea,[contenteditable=true],[role=dialog],[role=menu]",
      )
    )
      return;
    const active = (event.target as HTMLElement).closest<HTMLElement>("[data-explorer-entry]");
    const path = active?.dataset.explorerEntry ?? focused;
    const entry = tree.current.entries.find((item) => item.path === path);
    const cmd = event.metaKey || event.ctrlKey;
    const entries = entry ? picked(entry) : [...selected.values()];
    if (cmd && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelected(new Map(tree.current.entries.map((item) => [item.path, item])));
    } else if (cmd && ["c", "x", "v"].includes(event.key.toLowerCase())) {
      if (!writable && event.key.toLowerCase() !== "c") return;
      event.preventDefault();
      void run(() =>
        event.key.toLowerCase() === "v"
          ? paste(entry ? destinationFor(entry) : base)
          : setClipboard(entries, event.key.toLowerCase() === "x"),
      );
    } else if (event.key === "F2" && writable && entry) {
      event.preventDefault();
      openDialog("rename", [entry]);
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      writable &&
      entries.length
    ) {
      event.preventDefault();
      openDialog("trash", entries);
    } else if (event.key === "Escape") {
      setSelected(new Map());
    } else if (
      ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      const nodes = Array.from(
        root.current?.querySelectorAll<HTMLElement>("[data-explorer-entry]") ?? [],
      );
      const index = nodes.indexOf(active!);
      const next =
        event.key === "Home"
          ? nodes[0]
          : event.key === "End"
            ? nodes.at(-1)
            : nodes[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (tree.current.navigate) {
        const target = tree.current.navigate(path ?? "", event.key);
        const nextEntry =
          target === null
            ? undefined
            : tree.current.entries.find((item) => item.path === joinBrowseLocation(base, target));
        if (nextEntry) select(nextEntry, false, event.shiftKey);
      } else if (next) {
        next.focus();
        if (event.shiftKey)
          select(
            { path: next.dataset.explorerEntry!, directory: next.dataset.directory === "true" },
            false,
            true,
          );
      }
    } else if (event.key === "Enter" && active && event.target === active) {
      event.preventDefault();
      active.querySelector<HTMLButtonElement>("button")?.click();
    } else if (
      (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) &&
      entry &&
      active
    ) {
      event.preventDefault();
      const box = active.getBoundingClientRect();
      openMenu(entry, box.left, box.bottom);
    }
  };

  return (
    // Selection and transfer status intentionally update every action consumer.
    // eslint-disable-next-line react/jsx-no-constructed-context-values
    <ExplorerContext.Provider value={context}>
      <div
        ref={setRoot}
        className="relative flex min-h-0 flex-1 flex-col"
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest("input,[data-explorer-entry]")) return;
          event.preventDefault();
          openMenu({ path: base, directory: true }, event.clientX, event.clientY);
        }}
      >
        {children}
        {isDragActive && dropTarget && (
          <FileDropOverlay container={dropTarget} label="Drop files into this folder" />
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Upload files"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []).map((file) => ({
              file,
              path: file.name,
            }));
            if (files.length) {
              setUpload({ files, directories: [], destination: uploadDestination.current });
              setOverwrite(false);
            }
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={(node) => {
            folderInput.current = node;
            node?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          hidden
          aria-label="Upload folder"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []).map((file) => ({
              file,
              path: file.webkitRelativePath || file.name,
            }));
            if (files.length) {
              setUpload({ files, directories: [], destination: uploadDestination.current });
              setOverwrite(false);
            }
            event.currentTarget.value = "";
          }}
        />
      </div>
      {point &&
        createPortal(
          <DropdownMenu open modal={false} onOpenChange={(open) => !open && setPoint(null)}>
            <DropdownMenuTrigger asChild>
              <span className="fixed" style={{ left: point.x, top: point.y }} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
              {menu(point.entry)}
            </DropdownMenuContent>
          </DropdownMenu>,
          document.body,
        )}
      <Dialog
        open={pasteConflict !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPasteConflict(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace existing files?</DialogTitle>
            <DialogDescription>
              Items already exist in {pasteConflict?.destination || "the workspace root"}. Replace
              overwrites the existing destination items.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setPasteConflict(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!pasteConflict) return;
                  await paste(pasteConflict.destination, pasteConflict.clipboard, true);
                  setPasteConflict(null);
                })
              }
            >
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {dialog?.kind === "trash"
                ? `${dialog.entries.length} item(s) will be kept in this folder’s trash until restored or removed.`
                : dialog?.kind === "move"
                  ? "Use a workspace-relative or absolute folder path. Leave the destination empty for the workspace root."
                  : "Changes apply to files on the connected host."}
            </DialogDescription>
          </DialogHeader>
          {dialog?.kind === "trash" ? (
            <ul className="max-h-48 overflow-auto text-sm">
              {dialog.entries.map((entry) => (
                <li key={entry.path}>{entry.path}</li>
              ))}
            </ul>
          ) : (
            <label className="space-y-1 text-sm">
              <span>{dialog?.kind === "move" ? "Destination folder" : "Name"}</span>
              <Input
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !busy) {
                    event.preventDefault();
                    void run(applyDialog);
                  }
                }}
              />
            </label>
          )}
          {(dialog?.kind === "move" ||
            dialog?.kind === "duplicate" ||
            dialog?.kind === "rename") && (
            <label className="flex gap-2 text-sm">
              <Checkbox
                checked={overwrite}
                onCheckedChange={(checked) => setOverwrite(checked === true)}
              />
              Replace existing destination
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void run(applyDialog)}>
              {busy ? "Working…" : dialog?.kind === "trash" ? "Move to trash" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={trash !== null}
        onOpenChange={(open) => {
          if (!open) setTrash(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore deleted files</DialogTitle>
            <DialogDescription>
              Deleted items from the current folder’s trash. Existing files will not be overwritten.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-auto">
            {trash?.length === 0 && (
              <p className="text-sm text-muted-foreground">Trash is empty.</p>
            )}
            {trash?.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 break-all">{item.original_path}</span>
                <Button
                  size="sm"
                  disabled={busy || !writable}
                  onClick={() =>
                    void run(async () => {
                      await operation({ operation: "restore", path: base, ids: [item.id] });
                      await loadTrash();
                    })
                  }
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={upload !== null}
        onOpenChange={(open) => {
          if (!open) setUpload(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload {upload?.files.length} file(s)</DialogTitle>
            <DialogDescription>
              Folder structure is preserved. Files are written after each upload completes.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-sm">
            <span>Destination folder</span>
            <Input
              value={upload?.destination ?? ""}
              placeholder="Workspace root"
              onChange={(event) =>
                setUpload(
                  (previous) => previous && { ...previous, destination: event.target.value },
                )
              }
            />
          </label>
          <label className="flex gap-2 text-sm">
            <Checkbox
              checked={overwrite}
              onCheckedChange={(checked) => setOverwrite(checked === true)}
            />
            Replace existing files
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpload(null)}>
              Cancel
            </Button>
            <Button disabled={busy || !writable} onClick={() => void run(startUpload)}>
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ExplorerContext.Provider>
  );
}

export function ExplorerToolbar() {
  const ctx = useContext(ExplorerContext);
  if (!ctx) return null;
  const first = ctx.selected.values().next().value as ExplorerEntry | undefined;
  const target = first ?? { path: ctx.base, directory: true };
  return (
    <>
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-2 py-1"
        aria-label="File actions"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          title="New file"
          aria-label="New file"
          disabled={!ctx.writable || ctx.busy}
          onClick={() => ctx.newItem(false)}
        >
          <FilePlusIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="New folder"
          aria-label="New folder"
          disabled={!ctx.writable || ctx.busy}
          onClick={() => ctx.newItem(true)}
        >
          <FolderPlusIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Upload files"
          aria-label="Choose files to upload"
          disabled={!ctx.writable || ctx.busy}
          onClick={() => ctx.chooseUpload(false)}
        >
          <UploadIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Search file contents"
          aria-label="Search folder contents"
          onClick={() => ctx.search(ctx.base)}
        >
          <SearchIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Collapse all folders"
          aria-label="Collapse all folders"
          onClick={ctx.collapse}
        >
          <ListCollapseIcon />
        </Button>
        <Button size="sm" variant="ghost" title="Reveal active file" onClick={ctx.reveal}>
          Reveal active file
        </Button>
        {ctx.selected.size > 0 && (
          <span className="text-xs text-muted-foreground">{ctx.selected.size} selected</span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="ml-auto"
              aria-label="More file actions"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">{ctx.menu(target)}</DropdownMenuContent>
        </DropdownMenu>
      </div>
      {ctx.feedback}
    </>
  );
}

/** Shared trailing column for tree, filename results and changed-file rows. */
export function ExplorerRowActions({
  path,
  directory = false,
  deleted = false,
  bytes = null,
  conversationId,
}: {
  path: string;
  directory?: boolean;
  deleted?: boolean;
  bytes?: number | null;
  conversationId?: string;
}) {
  const ctx = useContext(ExplorerContext);
  const revealBase = useContext(RevealBaseContext);
  const entry = { path: joinBrowseLocation(ctx?.base ?? revealBase, path), directory };
  const sessionId = conversationId ?? ctx?.conversationId;
  const selecting = !deleted && (ctx?.selected.size ?? 0) > 0;
  return (
    <span
      data-explorer-action
      className="relative flex h-6 w-[104px] shrink-0 items-center justify-end"
      onClick={(event) => event.stopPropagation()}
    >
      {bytes !== null && !deleted && (
        <span
          data-file-size
          className="text-sm text-muted-foreground group-hover:invisible group-focus-within:invisible"
        >
          {formatBytes(bytes)}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-end gap-0.5">
        {ctx && !deleted && (
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
              selecting && "opacity-100 pointer-events-auto",
            )}
          >
            <Checkbox
              aria-label={`Select ${path}`}
              className="after:inset-0"
              checked={ctx.selected.has(entry.path)}
              onCheckedChange={() => ctx.select(entry, true, false)}
            />
          </span>
        )}
        <span
          data-file-actions
          className="flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        >
          {!deleted && sessionId && (!directory || ctx) && (
            <FileDownloadButton
              conversationId={sessionId}
              path={entry.path}
              revealOnHover={false}
              onDownload={directory && ctx ? () => ctx.download([entry]) : undefined}
            />
          )}
          <CopyPathButton
            path={entry.path}
            label={directory ? "Copy folder path" : "Copy path"}
            size="icon-xs"
          />
          {ctx && !deleted && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={`Actions for ${path}`}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                ctx.openMenu(entry, box.left, box.bottom);
              }}
            >
              <MoreHorizontalIcon />
            </Button>
          )}
        </span>
      </span>
    </span>
  );
}

export const explorerRowClass = "data-[drop-target=true]:bg-accent";
