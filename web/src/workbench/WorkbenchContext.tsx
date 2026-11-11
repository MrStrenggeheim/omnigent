import type { ActivitySource } from "./ActivityView";
import { createContext, useContext, type ReactNode } from "react";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";
import type { OpenFileOptions } from "@/shell/FileViewerContext";

export type WorkbenchViewKind =
  | "conversation"
  | "files"
  | "preview"
  | "changes"
  | "search"
  | "shells"
  | "terminal"
  | "agent-terminal"
  | "activity"
  | "automations"
  | "pr"
  | "browser"
  | "logs";

export interface OpenWorkbenchView {
  kind: WorkbenchViewKind;
  source?: ActivitySource;
  conversationId?: string;
  workspace?: WorkbenchWorkspace;
  workspaceId?: string;
  commentId?: string;
  initialDiff?: boolean;
  linkRequestId?: string;
  unavailableReason?: string;
  path?: string;
  terminalId?: string;
  title?: string;
  fileOptions?: OpenFileOptions;
  sourceViewId?: string;
  replaceOpen?: boolean;
  searchQuery?: string;
  terminalOwner?: "workspace" | "conversation";
  legacySessionResource?: boolean;
}

export interface WorkbenchActions {
  openConversation: (id: string, options?: { beside?: boolean; messageId?: string }) => void;
  openView: (request: OpenWorkbenchView, options?: { beside?: boolean }) => void;
  focusedConversationId?: string;
  openConversationIds?: readonly string[];
}

const WorkbenchContext = createContext<WorkbenchActions | null>(null);

export function WorkbenchProvider({
  value,
  children,
}: {
  value: WorkbenchActions;
  children: ReactNode;
}) {
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench() {
  return useContext(WorkbenchContext);
}
