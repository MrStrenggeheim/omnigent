import { resolveChatWorkspace } from "@/hooks/useWorkbenchSelection";
import { AGENT_TERMINAL_IDS, createTerminal, terminalDisplayLabel } from "@/hooks/useTerminals";
import { authenticatedFetch } from "@/lib/identity";
import { ApiError, apiErrorFromResponse } from "@/lib/sessionsApi";
import { panelFolderKey, readPanelFolder } from "@/lib/panelFolder";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import type { DockLayout, DockView } from "./dockLayout";
import type { OpenWorkbenchView } from "./WorkbenchContext";
import { focusedResourceTarget } from "./resourceTarget";
import { manualTerminalRecord, terminalEnded } from "./TerminalInventoryView";

type Kind = "files" | "terminal";
interface CapturedTarget {
  workspace?: WorkbenchWorkspace;
  conversationId?: string;
  workspaceId?: string;
  paneId?: string;
  path?: string;
}

function ownerKey(target: {
  workspace?: WorkbenchWorkspace;
  workspaceId?: string;
  conversationId?: string;
}): string {
  const workspaceId = target.workspace?.id ?? target.workspaceId;
  return workspaceId ? `workspace:${workspaceId}` : `conversation:${target.conversationId ?? ""}`;
}

function viewOwner(
  view: DockView,
): Pick<CapturedTarget, "workspace" | "workspaceId" | "conversationId"> {
  const target = focusedResourceTarget(view);
  return view.resource.terminalOwner === "conversation"
    ? { conversationId: target.conversationId }
    : {
        ...target,
        workspaceId:
          typeof view.resource.workspaceId === "string" ? view.resource.workspaceId : undefined,
      };
}

function isManualTerminal(view: DockView): boolean {
  return (
    view.kind === "terminal" &&
    typeof view.resource.terminalId === "string" &&
    !AGENT_TERMINAL_IDS.has(view.resource.terminalId)
  );
}

/** Shortcut reuse is separate from Open-menu actions, which intentionally allow extra views. */
export function createWorkbenchResourceShortcuts({
  getLayout,
  openView,
  focusView,
  onTerminalCreated,
}: {
  getLayout: () => DockLayout;
  openView: (request: OpenWorkbenchView, options?: { paneId?: string }) => void;
  focusView: (id: string) => void;
  onTerminalCreated: (workspace: WorkbenchWorkspace) => Promise<unknown>;
}) {
  const pending = new Map<string, Promise<void>>();
  const resolutions = new Map<string, Promise<WorkbenchWorkspace>>();
  const recent = new Map<string, string>();

  function remember(view: DockView | undefined) {
    if (view && (view.kind === "files" || isManualTerminal(view)))
      recent.set(`${view.kind}:${ownerKey(viewOwner(view))}`, view.id);
  }

  function capture(): CapturedTarget {
    const layout = getLayout();
    const pane = layout.panes.find((item) => item.id === layout.focusedPaneId);
    const view = layout.views.find((item) => item.id === pane?.selectedViewId);
    remember(view);
    const target: Pick<CapturedTarget, "workspace" | "workspaceId" | "conversationId"> = view
      ? viewOwner(view)
      : {};
    const folderOwner = target.workspace?.id ?? target.workspaceId ?? target.conversationId;
    return {
      ...target,
      paneId: pane?.id,
      path: folderOwner
        ? (readPanelFolder(panelFolderKey(folderOwner, view?.id)) ?? undefined)
        : undefined,
    };
  }

  function focusMatching(kind: Kind, target: CapturedTarget): boolean {
    const key = ownerKey(target);
    const matches = getLayout().views.filter(
      (view) =>
        view.kind === kind &&
        (kind !== "terminal" || isManualTerminal(view)) &&
        ownerKey(viewOwner(view)) === key,
    );
    const view =
      matches.find((candidate) => candidate.id === recent.get(`${kind}:${key}`)) ?? matches.at(-1);
    if (!view) return false;
    remember(view);
    focusView(view.id);
    return true;
  }

  function once(key: string, operation: () => Promise<void>): Promise<void> {
    const existing = pending.get(key);
    if (existing) return existing;
    const task = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key);
      });
    pending.set(key, task);
    return task;
  }

  async function resolve(target: CapturedTarget): Promise<CapturedTarget> {
    if (target.workspace || (!target.workspaceId && !target.conversationId)) return target;
    const key = ownerKey(target);
    let task = resolutions.get(key);
    if (!task) {
      const lookup = async () => {
        if (!target.workspaceId) return resolveChatWorkspace(target.conversationId!);
        const response = await authenticatedFetch(
          `/v1/workbench-workspaces/${encodeURIComponent(target.workspaceId)}`,
        );
        if (!response.ok) throw await apiErrorFromResponse(response);
        const workspace = await response.json();
        if (
          workspace.id !== target.workspaceId ||
          typeof workspace.root !== "string" ||
          !Array.isArray(workspace.capabilities)
        )
          throw new Error("The server returned an invalid workspace identity.");
        return workspace as WorkbenchWorkspace;
      };
      task = lookup().finally(() => {
        resolutions.delete(key);
      });
      resolutions.set(key, task);
    }
    return { ...target, workspace: await task };
  }

  async function create(target: CapturedTarget) {
    if (!target.workspace) {
      openView(
        { kind: "terminal", conversationId: target.conversationId, path: target.path },
        { paneId: target.paneId },
      );
      return;
    }
    const terminal = await createTerminal(
      target.conversationId ?? "",
      "shell",
      target.workspace,
      target.path,
    );
    await onTerminalCreated(target.workspace);
    openView(
      {
        kind: "terminal",
        workspace: target.workspace,
        conversationId: target.conversationId,
        path: target.path,
        terminalOwner: "workspace",
        terminalId: terminal.id,
        title: terminalDisplayLabel(terminal),
      },
      { paneId: target.paneId },
    );
  }

  function open(kind: Kind): Promise<void> {
    const captured = capture();
    if (focusMatching(kind, captured)) return Promise.resolve();
    const requestKey = `${kind}:${ownerKey(captured)}`;
    return once(requestKey, async () => {
      let target: CapturedTarget;
      try {
        target = await resolve(captured);
      } catch (error) {
        if (
          kind === "files" &&
          !captured.workspaceId &&
          error instanceof ApiError &&
          [403, 404, 405, 501].includes(error.status)
        ) {
          if (!focusMatching(kind, captured))
            openView(
              {
                kind,
                conversationId: captured.conversationId,
                path: captured.path,
                legacySessionResource: true,
              },
              { paneId: captured.paneId },
            );
          return;
        }
        throw error;
      }
      const perform = async () => {
        if (focusMatching(kind, target)) return;
        if (kind === "files" || !target.workspace) {
          openView(
            {
              kind,
              workspace: target.workspace,
              conversationId: target.conversationId,
              path: target.path,
            },
            { paneId: target.paneId },
          );
          return;
        }
        const response = await authenticatedFetch(
          `/v1/workbench-workspaces/${encodeURIComponent(target.workspace.id)}/terminals`,
        );
        if (!response.ok) throw await apiErrorFromResponse(response);
        const payload = await response.json();
        if (!Array.isArray(payload.data))
          throw new Error("Could not read the workspace shell inventory.");
        // Inventory is newest first; ended and agent-owned terminals cannot satisfy Ctrl+J.
        const terminal = payload.data
          .map(manualTerminalRecord)
          .find(
            (item: ReturnType<typeof manualTerminalRecord>) =>
              !AGENT_TERMINAL_IDS.has(item.id) &&
              !terminalEnded(item) &&
              (item.state === "running" || item.running),
          );
        if (focusMatching(kind, target)) return;
        if (terminal) {
          openView(
            {
              kind,
              workspace: target.workspace,
              conversationId: target.conversationId,
              terminalOwner: "workspace",
              terminalId: terminal.id,
              title: terminalDisplayLabel(terminal),
            },
            { paneId: target.paneId },
          );
        } else {
          if (payload.available === false || target.workspace.available === false)
            throw new Error("Workspace is offline; no running shell is available.");
          await create(target);
        }
      };
      const resolvedKey = `${kind}:${ownerKey(target)}`;
      await (resolvedKey === requestKey ? perform() : once(resolvedKey, perform));
    });
  }

  return {
    remember,
    openFiles: () => open("files"),
    openTerminal: () => open("terminal"),
    newTerminal: async () => {
      const target = capture();
      await create(await resolve(target));
    },
  };
}
