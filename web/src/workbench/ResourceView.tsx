import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MapPinIcon } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useHosts } from "@/hooks/useHosts";
import { useSession } from "@/hooks/useSession";
import { authenticatedFetch } from "@/lib/identity";
import { apiErrorFromResponse } from "@/lib/sessionsApi";
import { ResourceViewIdContext, usePanelFolder, useResourceViewState } from "@/lib/panelFolder";
import { WorkbenchWorkspaceProvider, type WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import { joinBrowseLocation } from "@/lib/workspacePaths";
import {
  getWorkspaceComparison,
  setWorkspaceComparison,
  type WorkspaceComparison,
} from "@/lib/workspaceComparison";
import { getExplorerGitScope, setExplorerGitScope } from "@/lib/explorerGitScope";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilesPanel } from "@/shell/FilesPanel";
import { ContentSearchPanel } from "@/shell/ContentSearchPanel";
import { FileViewer } from "@/shell/FileViewer";
import { PullRequestPanel } from "@/shell/PullRequestPanel";
import { WorkspacePickerDialog } from "@/shell/WorkspacePickerDialog";
import {
  FileViewerContext,
  type FileNavigationGuard,
  type FilePosition,
  type OpenFileOptions,
} from "@/shell/FileViewerContext";
import type { ChangedSort } from "@/shell/FlatFileList";

export interface ResourceOpenFileOptions extends OpenFileOptions {
  workspace?: WorkbenchWorkspace;
  sourceViewId: string;
  comparison?: WorkspaceComparison;
}
export interface ResourceViewProps {
  viewId: string;
  active?: boolean;
  annotationControl?: ReactNode;
  initialQuery?: string;
  replaceOpen?: boolean;
  autoFocus?: boolean;
  kind: "files" | "changes" | "search" | "preview" | "pr";
  workspace?: WorkbenchWorkspace;
  /** Explicit comment/captured-change owner; absence disables chat actions. */
  conversationId?: string;
  path?: string;
  commentId?: string;
  initialDiff?: boolean;
  linkRequestId?: string;
  position?: FilePosition;
  comparisonScope?: "files" | "changes";
  onOpenFile: (path: string, options: ResourceOpenFileOptions) => void;
  onWorkspaceChange?: (workspace: WorkbenchWorkspace) => void;
  registerNavigationGuard?: (guard: FileNavigationGuard) => () => void;
  onClose?: () => void;
}

/** A captured resource target; the shell owns placement and accepted target changes. */
export function ResourceView(props: ResourceViewProps) {
  if (!props.workspace && !props.conversationId)
    return <p role="status">No resource target selected.</p>;
  return (
    <ResourceViewIdContext.Provider value={props.viewId}>
      <WorkbenchWorkspaceProvider
        value={
          props.workspace
            ? { ...props.workspace, chatSessionId: props.conversationId ?? null }
            : null
        }
      >
        <ResourceViewBody
          key={`${props.viewId}:${props.workspace?.id ?? props.conversationId}`}
          {...props}
        />
      </WorkbenchWorkspaceProvider>
    </ResourceViewIdContext.Provider>
  );
}

function ResourceViewBody({
  viewId,
  active = true,
  annotationControl,
  initialQuery,
  replaceOpen = false,
  autoFocus = false,
  kind,
  workspace,
  conversationId,
  path,
  commentId,
  initialDiff,
  linkRequestId,
  position,
  comparisonScope,
  onOpenFile,
  onWorkspaceChange,
  registerNavigationGuard,
  onClose,
}: ResourceViewProps) {
  const inheritedContext = useContext(FileViewerContext);
  const hosts = useHosts({ enabled: !!workspace });
  const { session } = useSession(conversationId);
  const owner = workspace?.id ?? conversationId;
  const root = workspace?.root ?? session?.workspace ?? null;
  const folder = usePanelFolder(owner, root, viewId);
  const [showHidden, setShowHidden] = useResourceViewState(owner, viewId, "hidden", false);
  const [sort, setSort] = useResourceViewState<ChangedSort>(owner, viewId, "sort", "alpha");
  const [pickerHost, setPickerHost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardRef = useRef<FileNavigationGuard | undefined>(undefined);
  const annotationControlRef = useRef<HTMLDivElement>(null);
  const chooseAnnotationChat = useCallback(() => {
    annotationControlRef.current?.querySelector<HTMLButtonElement>("button")?.click();
  }, []);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const registerGuard = useCallback(
    (guard: FileNavigationGuard) => {
      guardRef.current = guard;
      const unregister = registerNavigationGuard?.(guard);
      return () => {
        if (guardRef.current === guard) guardRef.current = undefined;
        unregister?.();
      };
    },
    [registerNavigationGuard],
  );
  const guardTransition = useCallback((apply: () => void) => {
    if (guardRef.current) guardRef.current("", undefined, apply);
    else apply();
  }, []);
  const openFile = useCallback(
    (nextPath: string, options?: OpenFileOptions) => {
      const scope = kind === "changes" ? "changes" : kind === "files" ? "files" : comparisonScope;
      const comparison = getWorkspaceComparison({
        workspaceId: workspace?.id,
        conversationId,
        viewId,
        view: scope,
      });
      onOpenFile(nextPath, {
        ...options,
        workspaceId: workspace?.id,
        workspace,
        sourceViewId: viewId,
        comparisonScope: scope,
        comparison,
      });
    },
    [workspace, conversationId, viewId, kind, comparisonScope, onOpenFile],
  );
  const context = useMemo(
    () => ({
      openFile,
      openContentSearch: inheritedContext?.openContentSearch,
      registerNavigationGuard: registerGuard,
      beforeWorkspaceChange: guardTransition,
      openGithubTab: () => {},
      isChangedPath: () => false,
      conversationId,
      workspaceRoot: root,
      workspaceHome: workspace?.home ?? null,
      sessionHostId: workspace?.host_id ?? session?.hostId,
      activeFilePath: path,
    }),
    [
      openFile,
      inheritedContext?.openContentSearch,
      registerGuard,
      guardTransition,
      conversationId,
      workspace,
      root,
      session?.hostId,
      path,
    ],
  );

  async function changeLocation(hostId: string, nextRoot: string) {
    if (!workspace || !onWorkspaceChange) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/v1/workbench-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: hostId, root: nextRoot }),
      });
      if (!response.ok) throw await apiErrorFromResponse(response);
      const next = (await response.json()) as WorkbenchWorkspace;
      if (!next?.id || typeof next.root !== "string" || !Array.isArray(next.capabilities))
        throw new Error("The server returned an invalid workspace identity.");
      if (mounted.current) {
        const apply = () => onWorkspaceChange({ ...next, chatSessionId: null });
        if (registerNavigationGuard) apply();
        else guardTransition(apply);
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const selectedHost = hosts.data?.find((host) => host.host_id === workspace?.host_id);
  const currentHost = workspace?.host_id ?? `target:${workspace?.id ?? conversationId}`;
  const missingHost = !selectedHost;
  const unavailable = workspace?.available === false || selectedHost?.status === "offline";
  const locationControls = workspace ? (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        value={currentHost}
        disabled={busy || !onWorkspaceChange}
        onValueChange={setPickerHost}
      >
        <SelectTrigger aria-label="Machine" className="h-7 min-w-0 max-w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {missingHost && (
            <SelectItem value={currentHost}>
              {workspace.host_id ?? workspace.target_kind} (unavailable)
            </SelectItem>
          )}
          {hosts.data?.map((host) => (
            <SelectItem
              key={host.host_id}
              value={host.host_id}
              disabled={host.status === "offline"}
            >
              {host.name}
              {host.status === "offline" ? " (offline)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        className="min-w-0 truncate font-mono text-xs"
        aria-label="Select folder"
        title={joinBrowseLocation(workspace.root, folder)}
        disabled={busy || !onWorkspaceChange || !workspace.host_id}
        onClick={() => setPickerHost(workspace.host_id)}
      >
        {joinBrowseLocation(workspace.root, folder)}
      </Button>
    </div>
  ) : null;
  const previewLocationControls = locationControls ? (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Location">
          <MapPinIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-sm p-2">
        {locationControls}
      </PopoverContent>
    </Popover>
  ) : null;
  return (
    <FileViewerContext.Provider value={context}>
      <div className="flex h-full min-h-0 flex-col" data-resource-view={viewId}>
        {hosts.error && (
          <p role="alert" className="px-2 text-xs text-destructive">
            Could not load machines: {hosts.error.message}
          </p>
        )}
        {error && (
          <p role="alert" className="px-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {unavailable && (
          <p role="status" className="px-2 text-xs text-muted-foreground">
            Location unavailable: {workspace?.host_id ?? workspace?.target_kind} · {root}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {(kind === "files" || kind === "changes") && (
            <FilesPanel
              locationControls={locationControls}
              viewId={viewId}
              active={active}
              conversationId={conversationId}
              workspaceId={workspace?.id}
              view={kind}
              flatView={kind === "changes"}
              onFileSelect={openFile}
              showHidden={showHidden}
              onShowHiddenChange={setShowHidden}
              sort={sort}
              onSortChange={setSort}
              frameless
              hideLocation={!!workspace}
            />
          )}
          {kind === "search" && (
            <ContentSearchPanel
              initialQuery={initialQuery}
              replaceOpen={replaceOpen}
              autoFocus={active && autoFocus}
              locationControls={locationControls}
              viewId={viewId}
              conversationId={conversationId ?? ""}
              scope={folder}
              onFileSelect={openFile}
            />
          )}
          {kind === "pr" && (
            <PullRequestPanel
              locationControls={locationControls}
              hideLocation={!!workspace}
              active={active}
              viewId={viewId}
              conversationId={conversationId ?? ""}
            />
          )}
          {kind === "preview" &&
            (path ? (
              <FileViewer
                locationControls={
                  <>
                    {previewLocationControls}
                    {annotationControl && (
                      <div ref={annotationControlRef} className="min-w-0">
                        {annotationControl}
                      </div>
                    )}
                  </>
                }
                onChooseAnnotationChat={annotationControl ? chooseAnnotationChat : undefined}
                viewId={viewId}
                conversationId={conversationId ?? ""}
                agentId={session?.agentId ?? null}
                recipientValid={!!conversationId}
                workspaceId={workspace?.id}
                path={path}
                commentId={commentId}
                initialDiff={initialDiff}
                linkRequestId={linkRequestId}
                position={position}
                comparisonScope={comparisonScope}
                permissionLevel={workspace?.permission_level ?? session?.permissionLevel}
                open
                mediaActive={active}
                syncUrl={false}
                frameless
                onClose={() => guardTransition(() => onClose?.())}
                onNavigateTo={openFile}
              />
            ) : (
              <p role="status" className="p-3 text-sm">
                No file selected.
              </p>
            ))}
        </div>
        {pickerHost && workspace && (
          <WorkspacePickerDialog
            open
            hostId={pickerHost}
            initialPath={
              pickerHost === workspace.host_id
                ? joinBrowseLocation(workspace.root, folder)
                : undefined
            }
            title="Select folder"
            description="Choose the folder for this view."
            onOpenChange={(open) => {
              if (!open) setPickerHost(null);
            }}
            onConfirm={(nextRoot) => void changeLocation(pickerHost, nextRoot)}
          />
        )}
      </div>
    </FileViewerContext.Provider>
  );
}

/** Copy opening choices once; a preview never follows its source Explorer. */
export function inheritResourceViewState(
  sourceViewId: string,
  viewId: string,
  workspaceId: string | undefined,
  view: "files" | "changes",
  conversationId?: string,
) {
  const source = { workspaceId, conversationId, viewId: sourceViewId, view };
  const target = { workspaceId, conversationId, viewId, view };
  setWorkspaceComparison(target, getWorkspaceComparison(source));
  setExplorerGitScope(target, getExplorerGitScope(source));
}
