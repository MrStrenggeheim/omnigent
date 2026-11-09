import { useState } from "react";
import {
  ChevronDownIcon,
  FolderOpenIcon,
  MonitorIcon,
  MessageSquareIcon,
  CheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHosts } from "@/hooks/useHosts";
import type { useWorkbenchSelection } from "@/hooks/useWorkbenchSelection";
import type { WorkbenchWorkspace } from "@/lib/workbenchTypes";
import { WorkspacePickerDialog } from "./WorkspacePickerDialog";

export function WorkbenchSelector({
  selection,
  onSelect,
}: {
  selection: ReturnType<typeof useWorkbenchSelection>;
  onSelect: (workspace: WorkbenchWorkspace) => void;
}) {
  const [browsingHost, setBrowsingHost] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hosts = useHosts({ enabled: menuOpen });
  const workspace = selection.workspace;
  if (!workspace && !selection.error) return null;
  const title = workspace
    ? `${workspace.host_id ?? workspace.target_kind}: ${workspace.root}`
    : "Workspace unavailable";
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Select workspace"
            title={title}
            className="min-w-0 max-w-24 md:max-w-40 gap-1 px-1 text-xs"
          >
            <FolderOpenIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {workspace?.root.split(/[/\\]/).filter(Boolean).at(-1) ?? "Workspace"}
            </span>
            <ChevronDownIcon className="size-3 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-[min(32rem,calc(100vw-2rem))]">
          <DropdownMenuLabel>Workspace</DropdownMenuLabel>
          {selection.workspaces.map((item) => (
            <DropdownMenuItem key={item.id} onSelect={() => onSelect(item)} title={item.root}>
              <FolderOpenIcon />
              <span className="min-w-0 flex-1 truncate">{item.root}</span>
              {item.id === workspace?.id && <CheckIcon />}
            </DropdownMenuItem>
          ))}
          {selection.chatWorkspace && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSelect(selection.chatWorkspace!)}>
                <MessageSquareIcon />
                Open chat workspace
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Open folder on host</DropdownMenuLabel>
          {hosts.data?.map((host) => (
            <DropdownMenuItem
              key={host.host_id}
              disabled={host.status !== "online"}
              onSelect={() => setBrowsingHost(host.host_id)}
            >
              <MonitorIcon />
              {host.name}
              {host.status === "offline" ? " · Offline" : ""}
            </DropdownMenuItem>
          ))}
          {hosts.error && <DropdownMenuItem disabled>Could not load hosts</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {browsingHost && (
        <WorkspacePickerDialog
          open
          onOpenChange={(open) => {
            if (!open) setBrowsingHost(null);
          }}
          hostId={browsingHost}
          initialPath={workspace?.host_id === browsingHost ? workspace.root : undefined}
          title="Open workspace folder"
          description="Choose the folder for Files, Search, Git and manual terminals."
          onConfirm={(root) => {
            selection.create.mutate({ hostId: browsingHost, root }, { onSuccess: onSelect });
          }}
        />
      )}
      {selection.create.error && (
        <span role="alert" className="text-xs text-destructive">
          {selection.create.error.message}
        </span>
      )}
    </>
  );
}
