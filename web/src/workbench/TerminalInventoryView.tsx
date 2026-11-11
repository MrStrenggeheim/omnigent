import { useQuery } from "@tanstack/react-query";
import { PlusIcon, RefreshCwIcon, TerminalIcon } from "lucide-react";
import { ActivityRow } from "@/components/ActivityRow";
import { Button } from "@/components/ui/button";
import { TooltipButton } from "@/components/ui/tooltip";
import {
  terminalDisplayLabel,
  terminalInfoFromResource,
  type TerminalInfo,
} from "@/hooks/useTerminals";
import { stripAnsi } from "@/lib/ansi";
import { authenticatedFetch } from "@/lib/identity";
import { LEVEL_OWNER } from "@/lib/permissionsApi";
import { apiErrorFromResponse } from "@/lib/sessionsApi";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";

export interface ManualTerminalRecord extends TerminalInfo {
  state: string;
  connectivity: string;
  output: string;
  exitCode?: number;
}

export function terminalHistoryKey(workspaceId: string) {
  return ["workbench-terminal-history", workspaceId] as const;
}

export function manualTerminalRecord(raw: Record<string, unknown>): ManualTerminalRecord {
  const info = terminalInfoFromResource(raw);
  if (!info) throw new Error("The shell response has no terminal identity.");
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
  const output = raw.output ?? metadata.output;
  const exitCode = raw.exit_code ?? metadata.exit_code;
  return {
    ...info,
    state: String(raw.state ?? metadata.state ?? "unknown"),
    connectivity: String(raw.connectivity ?? metadata.connectivity ?? "unknown"),
    output: typeof output === "string" ? output : "",
    exitCode: typeof exitCode === "number" ? exitCode : undefined,
  };
}

export function terminalEnded(terminal: ManualTerminalRecord) {
  return terminal.state === "stopped" || terminal.state === "exited";
}

export function terminalStateLabel(terminal: ManualTerminalRecord) {
  if (terminal.state === "stopped") return "Stopped";
  if (terminal.state === "exited")
    return terminal.exitCode === undefined ? "Exited" : `Exited (code ${terminal.exitCode})`;
  if (terminal.connectivity === "disconnected") return "Offline · process state unconfirmed";
  if (terminal.connectivity !== "connected")
    return "Connection unknown · process state unconfirmed";
  return terminal.state === "running" ? "Running" : "Process state unknown";
}

export function RetainedTerminalOutput({ terminal }: { terminal: ManualTerminalRecord }) {
  return (
    <div className="min-h-0 overflow-auto p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Retained output is a bounded snapshot, not a complete command history.
      </p>
      {terminal.output ? (
        <pre
          aria-label="Retained shell output"
          className="whitespace-pre-wrap break-words font-mono text-xs"
        >
          {stripAnsi(terminal.output)}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">No output was retained.</p>
      )}
    </div>
  );
}

export function TerminalInventoryView({
  workspace,
  active,
  onOpenTerminal,
  onNewTerminal,
}: {
  workspace: WorkbenchWorkspace;
  active: boolean;
  onOpenTerminal: (terminalId: string) => void;
  onNewTerminal: () => void;
}) {
  // The legacy live-tab hook excludes exited/stopped rows; this cache retains them.
  const inventory = useQuery({
    queryKey: [...terminalHistoryKey(workspace.id), "list"],
    queryFn: async ({ signal }) => {
      const response = await authenticatedFetch(
        `/v1/workbench-workspaces/${encodeURIComponent(workspace.id)}/terminals`,
        { signal },
      );
      if (!response.ok) throw await apiErrorFromResponse(response);
      const payload = await response.json();
      return {
        terminals: (payload.data ?? []).map((row: Record<string, unknown>) =>
          manualTerminalRecord(row),
        ) as ManualTerminalRecord[],
        available: payload.available !== false,
      };
    },
    enabled: active,
    refetchInterval: active ? 5_000 : false,
    staleTime: 2_000,
    retry: false,
    throwOnError: false,
  });
  const canCreate =
    (workspace.permission_level ?? 0) >= LEVEL_OWNER &&
    workspace.available !== false &&
    inventory.data?.available === true &&
    !inventory.error;
  return (
    <section aria-label="Shell inventory" className="flex h-full min-h-0 flex-col">
      <header className="workspace-control-header flex shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-sm">Shells · {workspace.root}</span>
        <TooltipButton
          type="button"
          aria-label="Refresh shells"
          disabled={inventory.isFetching}
          onClick={() => void inventory.refetch()}
          className="flex size-7 items-center justify-center rounded hover:bg-muted"
        >
          <RefreshCwIcon className="size-3.5" />
        </TooltipButton>
        <TooltipButton
          type="button"
          aria-label="New shell"
          disabled={!canCreate}
          onClick={onNewTerminal}
          className="flex size-7 items-center justify-center rounded hover:bg-muted"
        >
          <PlusIcon className="size-3.5" />
        </TooltipButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {inventory.error && (
          <p role="alert" className="text-sm text-destructive">
            {inventory.error.message}
          </p>
        )}
        {inventory.isLoading && (
          <p role="status" className="text-sm">
            Loading shells…
          </p>
        )}
        {inventory.data?.available === false && (
          <p role="status" className="text-sm text-muted-foreground">
            Host offline. Showing retained shell records.
          </p>
        )}
        {inventory.data?.terminals.length === 0 && (
          <p className="text-sm text-muted-foreground">No retained shells in this workspace.</p>
        )}
        {inventory.data?.terminals.map((terminal) => (
          <ActivityRow
            key={terminal.id}
            icon={<TerminalIcon className="size-3.5" />}
            title={
              <Button variant="ghost" size="sm" onClick={() => onOpenTerminal(terminal.id)}>
                {terminalDisplayLabel(terminal)}
              </Button>
            }
            status={terminalStateLabel(terminal)}
          >
            <RetainedTerminalOutput terminal={terminal} />
          </ActivityRow>
        ))}
      </div>
    </section>
  );
}
