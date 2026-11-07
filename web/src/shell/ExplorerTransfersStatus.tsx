import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  cancelExplorerTransfer,
  dismissExplorerTransfer,
  getExplorerTransfers,
  subscribeExplorerTransfers,
  transferIsActive,
} from "@/lib/explorerTransfers";

/** Mount once in AppShell so transfer controls survive workspace/session changes. */
export function ExplorerTransfersStatus() {
  const transfers = useSyncExternalStore(subscribeExplorerTransfers, getExplorerTransfers);
  if (!transfers.length) return null;
  return (
    <aside
      aria-label="File transfers"
      className="fixed right-3 bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] z-[70] max-h-[40vh] w-[min(22rem,calc(100vw-1.5rem))] space-y-2 overflow-y-auto rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      {transfers.map((transfer) => (
        <div
          key={transfer.conversationId}
          role={transfer.status === "failed" ? "alert" : "status"}
          className="space-y-1 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium">
              {transfer.kind === "upload" ? "Upload" : "Download"}: {transfer.name}
            </span>
            <span className="shrink-0 text-muted-foreground" title={transfer.conversationId}>
              Session {transfer.conversationId.slice(0, 8)}
            </span>
          </div>
          {transferIsActive(transfer) && (
            <Progress
              aria-label={`${transfer.kind} progress`}
              value={Math.min(100, (transfer.completed / (transfer.total || 1)) * 100)}
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <span
              className={
                transfer.status === "failed"
                  ? "break-words text-destructive"
                  : "break-words text-muted-foreground"
              }
            >
              {transfer.message ??
                `${Math.round((transfer.completed / (transfer.total || 1)) * 100)}%`}
            </span>
            {transferIsActive(transfer) ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={transfer.status === "cancelling"}
                onClick={() => cancelExplorerTransfer(transfer.conversationId)}
              >
                Cancel {transfer.kind}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => dismissExplorerTransfer(transfer.conversationId)}
                aria-label={`Dismiss ${transfer.kind} status`}
              >
                Dismiss
              </Button>
            )}
          </div>
        </div>
      ))}
    </aside>
  );
}
