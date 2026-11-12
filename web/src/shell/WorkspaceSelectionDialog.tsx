import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ClockIcon, MonitorIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHosts, type Host } from "@/hooks/useHosts";
import { useRecentWorkspaces } from "@/hooks/useRecentWorkspaces";
import { cn } from "@/lib/utils";
import { ConnectHostDialog } from "./ConnectHostInstructions";
import { WorkspacePicker, isNavigablePath, type WorkspacePickerHandle } from "./WorkspacePicker";

export interface WorkspaceSelection {
  hostId: string | null;
  path: string;
}

export type WorkspaceSelectionHandler = (
  selection: WorkspaceSelection,
) => void | boolean | Promise<void | boolean>;

export interface WorkspaceSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostId: string | null;
  initialPath?: string;
  onConfirm: WorkspaceSelectionHandler;
  /** Execution workspace changes can only target the current host. */
  allowHostChange?: boolean;
  hostLabel?: string;
  hosts?: Host[];
  hostActions?: ReactNode;
  /** Cloud workspaces have no filesystem until their runner is provisioned. */
  pathUnavailableReason?: string;
  workspacePath?: string;
  occupancyForPath?: (path: string) => number;
  onCancel?: () => void;
  title?: string;
  description?: string;
  busy?: boolean;
  children?: ReactNode;
  /** The owner controls dismissal when applying execution changes. */
  closeOnConfirm?: boolean;
}

/** Each opening gets an isolated draft; false/rejected confirmation retains it. */
export function WorkspaceSelectionDialog(props: WorkspaceSelectionDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onCancel?.();
        props.onOpenChange(next);
      }}
    >
      {props.open && <WorkspaceSelectionContent {...props} />}
    </Dialog>
  );
}

function WorkspaceSelectionContent({
  hostId,
  initialPath,
  onOpenChange,
  onConfirm,
  allowHostChange = true,
  hostLabel,
  hosts: suppliedHosts,
  hostActions,
  pathUnavailableReason,
  workspacePath,
  occupancyForPath,
  onCancel,
  title = "Select workspace",
  description = "Choose a host and folder to use as the workspace.",
  busy = false,
  children,
  closeOnConfirm = true,
}: WorkspaceSelectionDialogProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const hostsQuery = useHosts({ refetchOnFocus: connectOpen });
  const hosts = suppliedHosts ?? hostsQuery.data ?? [];
  const [selectedHostId, setSelectedHostId] = useState(hostId);
  const [drafts, setDrafts] = useState<Record<string, string>>({
    [hostId ?? ""]: initialPath ?? "",
  });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<WorkspacePickerHandle>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // A closed or replaced opening must never dismiss a later opening.
  // The ref is cleared by the content's lifecycle, independently of the caller.
  const { recent, addRecent } = useRecentWorkspaces(selectedHostId);
  const selectedHost = hosts.find((host) => host.host_id === selectedHostId);
  const choices = allowHostChange ? hosts : hosts.filter((host) => host.host_id === hostId);
  const missingSelected = !choices.some((host) => host.host_id === selectedHostId);

  async function confirm(path: string) {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setConfirming(true);
    setError(null);
    try {
      const result = await onConfirm({ hostId: selectedHostId, path });
      if (result === false || !mounted.current) return;
      addRecent(path);
      if (closeOnConfirm) onOpenChange(false);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) setConfirming(false);
    }
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="flex max-h-[calc(100dvh-2rem)] max-w-[min(64rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[min(64rem,calc(100vw-2rem))]"
      data-testid="workspace-selection-dialog"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const content = event.currentTarget as HTMLElement;
        requestAnimationFrame(() =>
          content
            ?.querySelector<HTMLInputElement>('[data-testid="workspace-picker-path-input"]')
            ?.focus(),
        );
      }}
    >
      <DialogHeader className="relative shrink-0 border-b bg-[var(--workspace-appbar)] px-5 py-4 pr-14 text-left">
        <DialogTitle className="text-base">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close"
          className="absolute right-3 top-2 min-h-11 min-w-11"
          onClick={() => {
            onCancel?.();
            onOpenChange(false);
          }}
        >
          <XIcon className="size-4" />
        </Button>
      </DialogHeader>
      <div
        className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[15rem_minmax(0,1fr)]"
        data-testid="workspace-selection-sections"
      >
        <section
          aria-label="Host"
          className="border-b bg-[var(--workspace-chrome)] px-3 py-4 md:border-r md:border-b-0"
        >
          <h3 className="mb-3 px-2 text-sm font-medium text-muted-foreground">Host</h3>
          {missingSelected && selectedHostId !== null && (
            <button
              type="button"
              aria-pressed="true"
              className="flex min-h-11 w-full items-center gap-2 rounded-md bg-[var(--workspace-selected)] px-3 py-2 text-left text-sm"
            >
              <MonitorIcon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{hostLabel ?? selectedHostId}</span>
              <CheckIcon className="size-4 text-primary" aria-hidden />
            </button>
          )}
          {choices.map((host) => (
            <button
              type="button"
              key={host.host_id}
              disabled={busy || confirming || host.status !== "online"}
              aria-pressed={host.host_id === selectedHostId}
              onClick={() => {
                setSelectedHostId(host.host_id);
                setError(null);
              }}
              className={cn(
                "my-0.5 flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left outline-none hover:bg-[var(--workspace-content)] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                host.host_id === selectedHostId &&
                  "bg-[var(--workspace-selected)] hover:bg-[var(--workspace-selected)]",
              )}
              data-testid={`workspace-selection-host-${host.host_id}`}
            >
              <MonitorIcon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{host.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      host.status === "online" ? "bg-green-600" : "bg-muted-foreground",
                    )}
                  />
                  {host.status === "online" ? "Connected" : "Offline"}
                </span>
              </span>
              {host.host_id === selectedHostId && (
                <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
              )}
            </button>
          ))}
          {selectedHostId === null && (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              {hostLabel ?? "Choose a host"}
            </p>
          )}
          {hostsQuery.error && !suppliedHosts && (
            <p role="alert" className="px-2 text-sm text-destructive">
              {hostsQuery.error.message}
            </p>
          )}
          <ConnectHostDialog open={connectOpen} onOpenChange={setConnectOpen}>
            <Button
              type="button"
              variant="ghost"
              className="mt-3 min-h-11 w-full justify-start text-sm text-muted-foreground"
            >
              <PlusIcon className="size-4" aria-hidden />
              Add host…
            </Button>
          </ConnectHostDialog>
          {hostActions}
        </section>
        <section
          aria-label="Path"
          className="flex min-h-0 min-w-0 flex-col bg-[var(--workspace-content)] px-4 py-4 md:px-5"
        >
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Path</h3>
          {pathUnavailableReason && selectedHostId === null ? (
            <p className="text-sm text-muted-foreground">{pathUnavailableReason}</p>
          ) : (
            <fieldset
              disabled={busy || confirming}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              <WorkspacePicker
                key={selectedHostId ?? "current"}
                embedded
                selectionRef={picker}
                hostId={selectedHostId}
                initialPath={
                  isNavigablePath(drafts[selectedHostId ?? ""] ?? "")
                    ? drafts[selectedHostId ?? ""]
                    : undefined
                }
                workspacePath={selectedHostId === hostId ? workspacePath : undefined}
                occupancyForPath={selectedHostId === hostId ? occupancyForPath : undefined}
                onPathChange={(path) =>
                  setDrafts((previous) =>
                    previous[selectedHostId ?? ""] === path
                      ? previous
                      : { ...previous, [selectedHostId ?? ""]: path },
                  )
                }
                onSelect={(path) => void confirm(path)}
              />
              {recent.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs text-muted-foreground">Recent paths on this host</p>
                  {recent.map((path) => (
                    <button
                      type="button"
                      key={path}
                      onClick={() => picker.current?.navigate(path)}
                      className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
                    >
                      <ClockIcon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{path}</span>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {children}
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
      </div>
      <div
        className="flex shrink-0 justify-end gap-2 border-t bg-[var(--workspace-content)] px-5 py-3"
        data-testid="workspace-selection-footer"
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11 md:min-h-9"
          onClick={() => {
            onCancel?.();
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="min-h-11 flex-1 md:min-h-9 md:flex-none"
          disabled={
            busy || confirming || selectedHostId === null || selectedHost?.status === "offline"
          }
          onClick={() => picker.current?.confirm()}
        >
          Use workspace
        </Button>
      </div>
    </DialogContent>
  );
}
