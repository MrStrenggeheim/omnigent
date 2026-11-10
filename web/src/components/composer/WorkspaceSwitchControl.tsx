import { useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "@/lib/routing";
import { FolderIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkspacePathField } from "@/shell/WorkspacePathField";
import { WorkspacePickerDialog } from "@/shell/WorkspacePickerDialog";
import { FileViewerContext } from "@/shell/FileViewerContext";
import { useRecentWorkspaces } from "@/hooks/useRecentWorkspaces";
import { authenticatedFetch } from "@/lib/identity";
import { apiErrorFromResponse } from "@/lib/sessionsApi";
import { notify, toast, updateNotification } from "@/lib/notifications";
import { useChatStore } from "@/store/chatStore";
import { COMPOSER_WORKSPACE_COLLAPSED_LABEL_CLASS } from "./ChatComposer";

interface Operation {
  id: string;
  phase: string;
  blocked: boolean;
  target_workspace: string;
  previous_workspace: string;
  error: string | null;
  restored?: boolean;
  recovery_error?: string | null;
}
interface Snapshot {
  host_id: string;
  workspace: string;
  runner_id: string | null;
  operation: Operation | null;
  can_recover: boolean;
  unchanged?: boolean;
  validated_workspace?: string;
}
const PHASES: Record<string, string> = {
  stopping: "Stopping agent…",
  starting: "Starting agent…",
  connecting: "Reconnecting agent…",
};

async function readWorkspace(sessionId: string): Promise<Snapshot> {
  const response = await authenticatedFetch(
    `/v1/sessions/${encodeURIComponent(sessionId)}/workspace`,
  );
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response.json();
}

interface WorkspaceSwitchProps {
  sessionId: string;
  hostId: string;
  workspace: string;
  disabledReason?: string;
}

/** Keep an asynchronous switch attached to its original chat across composer reuse. */
export function WorkspaceSwitchControl(props: WorkspaceSwitchProps) {
  return <WorkspaceSwitchState key={props.sessionId} {...props} />;
}

function WorkspaceSwitchState({
  sessionId,
  hostId,
  workspace,
  disabledReason,
}: WorkspaceSwitchProps) {
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [checking, setChecking] = useState(false);
  const prepareSequence = useRef(0);
  useEffect(
    () => () => {
      prepareSequence.current += 1;
    },
    [],
  );
  const [folder, setFolder] = useState(workspace);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();
  const fileContext = useContext(FileViewerContext);
  const { recent, addRecent } = useRecentWorkspaces(hostId);
  const activeNotice = useRef<string | undefined>(undefined);
  const settledNotice = useRef<string | undefined>(undefined);
  const query = useQuery({
    queryKey: ["session-workspace", sessionId],
    queryFn: () => readWorkspace(sessionId),
    refetchInterval: (q) => (q.state.data?.operation?.blocked ? 1000 : false),
    retry: false,
  });
  const operation = query.data?.operation;
  const busy = !!operation?.blocked && !query.data?.can_recover;

  const reflect = (snapshot: Snapshot, reveal = false) => {
    const op = snapshot.operation;
    if (!op) {
      if (!mutation.isPending) useChatStore.getState().setWorkspaceSwitching(sessionId, false);
      return;
    }
    const id = `workspace-switch:${sessionId}:${op.id}`;
    if (mutation.isPending && activeNotice.current && activeNotice.current !== id) return;
    const switching = op.blocked;
    useChatStore.getState().setWorkspaceSwitching(sessionId, switching);
    if (!switching && activeNotice.current === id && settledNotice.current !== id) {
      settledNotice.current = id;
      void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["chat-workbench-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
    const entry = {
      title:
        op.phase === "completed"
          ? "Workspace changed"
          : op.phase === "failed"
            ? "Workspace change failed"
            : "Changing workspace",
      description: op.error ?? `${op.previous_workspace} → ${op.target_workspace}`,
      type:
        op.phase === "failed"
          ? ("error" as const)
          : op.blocked
            ? ("loading" as const)
            : ("success" as const),
      progress:
        op.blocked && op.phase !== "failed"
          ? { active: true, label: PHASES[op.phase] ?? "Changing workspace…" }
          : undefined,
    };
    if (activeNotice.current === id) updateNotification(id, entry, { reveal });
    else if (switching || reveal) {
      notify({ id, ...entry });
      activeNotice.current = id;
    }
  };
  useEffect(() => {
    if (query.data) reflect(query.data);
  }, [query.data, query.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: async ({ target, recover }: { target: string; recover?: string }) => {
      const before = await readWorkspace(sessionId);
      if ((before.workspace !== workspace || before.host_id !== hostId) && !recover) {
        queryClient.setQueryData(["session-workspace", sessionId], before);
        void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
        throw new Error(
          "Workspace changed elsewhere. Reopen the switcher and review the current folder.",
        );
      }
      const requestId = crypto.randomUUID();
      activeNotice.current = `workspace-switch:${sessionId}:${requestId}`;
      toast.loading("Changing workspace", { id: activeNotice.current, description: target });
      useChatStore.getState().setWorkspaceSwitching(sessionId, true);
      const response = await authenticatedFetch(
        `/v1/sessions/${encodeURIComponent(sessionId)}/workspace`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request_id: requestId,
            workspace: target,
            expected_host_id: before.host_id,
            expected_workspace: before.workspace,
            expected_runner_id: before.runner_id,
            ...(recover ? { recover_operation_id: recover } : {}),
          }),
        },
      );
      if (!response.ok) throw await apiErrorFromResponse(response);
      return (await response.json()) as Snapshot;
    },
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(["session-workspace", sessionId], snapshot);
      if (snapshot.unchanged) {
        useChatStore.getState().setWorkspaceSwitching(sessionId, false);
        if (activeNotice.current)
          updateNotification(
            activeNotice.current,
            {
              title: "Workspace unchanged",
              type: "info",
              description: snapshot.workspace,
              progress: undefined,
            },
            { reveal: true },
          );
        setOpen(false);
        return;
      } else reflect(snapshot, true);
      if (snapshot.operation?.blocked && snapshot.operation.phase !== "failed") return;
      if (snapshot.operation?.phase === "failed") {
        setError(snapshot.operation.error);
        return;
      }
      if (snapshot.operation?.previous_workspace) addRecent(snapshot.operation.previous_workspace);
      addRecent(snapshot.workspace);
      setOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session", sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["chat-workbench-workspace"] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
      // Only clear this chat's file URL; an asynchronous switch may finish after navigation.
      if (useChatStore.getState().conversationId === sessionId)
        setSearchParams(
          (previous) => {
            const next = new URLSearchParams(previous);
            for (const key of ["workspace", "file", "diff", "comment"]) next.delete(key);
            return next;
          },
          { replace: true },
        );
    },
    onError: async (failure) => {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      let blocked: boolean;
      try {
        const snapshot = await readWorkspace(sessionId);
        blocked = !!snapshot.operation?.blocked;
        queryClient.setQueryData(["session-workspace", sessionId], snapshot);
        reflect(snapshot, true);
      } catch {
        blocked = true;
      }
      useChatStore.getState().setWorkspaceSwitching(sessionId, blocked);
      if (activeNotice.current)
        updateNotification(
          activeNotice.current,
          {
            title: "Workspace change not completed",
            description: message,
            type: "error",
            progress: undefined,
          },
          { reveal: true },
        );
    },
  });
  const changing = checking || mutation.isPending || busy;
  function closeDialog(next: boolean) {
    if (!next) prepareSequence.current += 1;
    setOpen(next);
  }
  async function change(target: string, recover?: string) {
    setError(null);
    const sequence = ++prepareSequence.current;
    setChecking(true);
    try {
      const before = await readWorkspace(sessionId);
      if ((before.workspace !== workspace || before.host_id !== hostId) && !recover) {
        queryClient.setQueryData(["session-workspace", sessionId], before);
        void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
        void queryClient.invalidateQueries({ queryKey: ["chat-workbench-workspace"] });
        throw new Error("The chat context changed elsewhere. Reopen the switcher to review it.");
      }

      const response = await authenticatedFetch(
        `/v1/sessions/${encodeURIComponent(sessionId)}/workspace`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            validate_only: true,
            request_id: crypto.randomUUID(),
            workspace: target,
            expected_host_id: before.host_id,
            expected_workspace: before.workspace,
            expected_runner_id: before.runner_id,
            ...(recover ? { recover_operation_id: recover } : {}),
          }),
        },
      );
      if (!response.ok) throw await apiErrorFromResponse(response);
      const prepared = (await response.json()) as Snapshot;
      if (sequence !== prepareSequence.current) return;
      if (prepared.unchanged) {
        toast.info("Workspace unchanged", { description: prepared.workspace });
        closeDialog(false);
        return;
      }
      const apply = () => {
        if (sequence === prepareSequence.current)
          mutation.mutate({ target: prepared.validated_workspace ?? target, recover });
      };
      if (fileContext?.beforeWorkspaceChange)
        fileContext.beforeWorkspaceChange(apply, () => closeDialog(false));
      else apply();
    } catch (failure) {
      if (sequence !== prepareSequence.current) return;
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      toast.error("Could not change workspace", { description: message });
    } finally {
      setChecking(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 min-w-0 max-w-[calc(50%-0.25rem)] gap-1 px-1 text-xs font-normal text-muted-foreground"
        data-testid="composer-workspace-dir"
        aria-label={`Change workspace: ${workspace}`}
        title={disabledReason ?? `Working directory: ${workspace}. Change workspace`}
        disabled={!!disabledReason && !operation?.blocked}
        onClick={() => {
          setFolder(operation?.blocked ? operation.target_workspace : workspace);
          setError(null);
          setOpen(true);
        }}
      >
        {changing ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <FolderIcon className="size-3.5 shrink-0" />
        )}
        <span
          data-workspace-collapse-label=""
          className={`min-w-0 truncate ${COMPOSER_WORKSPACE_COLLAPSED_LABEL_CLASS}`}
        >
          {changing
            ? "Changing workspace…"
            : operation?.blocked
              ? "Recover workspace"
              : workspace.split(/[\\/]/).filter(Boolean).at(-1)}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change workspace</DialogTitle>
            <DialogDescription>
              The agent restarts in the selected folder and continues this chat. Files and existing
              manual terminals stay where they are.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={changing}>
            <label className="space-y-2 text-sm">
              <span>Workspace folder</span>
              <WorkspacePathField
                hostId={hostId}
                value={folder}
                onChange={setFolder}
                onBrowse={() => setBrowsing(true)}
                recent={recent}
                dropdownDisabled={changing || browsing}
              />
            </label>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            {operation?.blocked ? "Previous folder: " : "Current folder: "}
            {operation?.blocked
              ? operation.previous_workspace
              : (query.data?.workspace ?? workspace)}
          </p>
          {changing && (
            <p role="status" className="text-sm text-muted-foreground">
              {checking
                ? "Checking folder…"
                : (PHASES[operation?.phase ?? ""] ?? "Changing workspace…")}
            </p>
          )}
          {(error || operation?.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error ?? operation?.error}
              {operation?.restored ? " The original workspace was restored." : ""}
              {operation?.recovery_error ? ` Reconnect the agent: ${operation.recovery_error}` : ""}
            </p>
          )}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => closeDialog(false)}>
              {changing ? "Hide" : "Cancel"}
            </Button>
            {query.data?.can_recover && (
              <Button
                variant="outline"
                onClick={() => change(operation!.previous_workspace, operation!.id)}
              >
                Restore original
              </Button>
            )}
            <Button
              disabled={
                changing ||
                !folder.trim() ||
                (!query.data?.can_recover && (!!disabledReason || folder.trim() === workspace))
              }
              onClick={() =>
                change(folder.trim(), query.data?.can_recover ? operation?.id : undefined)
              }
            >
              {changing
                ? "Changing…"
                : query.data?.can_recover
                  ? "Retry change"
                  : "Change workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <WorkspacePickerDialog
        open={browsing}
        onOpenChange={setBrowsing}
        hostId={hostId}
        initialPath={folder}
        workspacePath={workspace}
        onConfirm={setFolder}
      />
    </>
  );
}
