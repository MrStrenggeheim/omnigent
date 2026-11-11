import { useEffect, useRef, useState } from "react";
import { useHosts } from "@/hooks/useHosts";
import { authenticatedFetch } from "@/lib/identity";
import { apiErrorFromResponse } from "@/lib/sessionsApi";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WorkspacePickerDialog } from "@/shell/WorkspacePickerDialog";
import { ConnectHostInstructions } from "@/shell/NewChatDialog";
import { getCliServerUrl } from "@/lib/host";

export function OpenLocationDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (workspace: WorkbenchWorkspace) => void;
}) {
  const hosts = useHosts();
  const [connect, setConnect] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current += 1;
    if (!open) {
      setHostId(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);
  const resolve = async (root: string) => {
    const request = ++epoch.current;
    const selectedHost = hostId;
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/v1/workbench-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: selectedHost, root }),
      });
      if (!response.ok) throw await apiErrorFromResponse(response);
      const workspace = (await response.json()) as WorkbenchWorkspace;
      if (request === epoch.current) onSelect(workspace);
    } catch (cause) {
      if (request === epoch.current)
        setError(cause instanceof Error ? cause.message : "Could not open location");
    } finally {
      if (request === epoch.current) setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open={open && !hostId}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select machine</DialogTitle>
            <DialogDescription>
              Choose an existing machine, then a folder for this view.
            </DialogDescription>
          </DialogHeader>
          {hosts.isLoading && <p role="status">Loading machines…</p>}
          {(error || hosts.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || hosts.error?.message}
            </p>
          )}
          {busy && <p role="status">Opening location…</p>}
          {hosts.data?.map((host) => (
            <Button
              variant="ghost"
              key={host.host_id}
              disabled={host.status !== "online" || busy}
              className="justify-start"
              onClick={() => setHostId(host.host_id)}
            >
              {host.name}
              {host.status !== "online" ? " · offline" : ""}
            </Button>
          ))}
          <Button variant="outline" onClick={() => setConnect((value) => !value)}>
            Add machine
          </Button>
          {connect && (
            <ConnectHostInstructions
              serverUrl={getCliServerUrl()}
              label="Run on the machine you want to add:"
            />
          )}
        </DialogContent>
      </Dialog>
      <WorkspacePickerDialog
        open={open && !!hostId && !busy}
        hostId={hostId}
        title="Select folder"
        description="Choose the folder for this view."
        onOpenChange={(next) => {
          if (!next) setHostId(null);
        }}
        onConfirm={(root) => {
          void resolve(root);
        }}
      />
    </>
  );
}
