/** Native docking payload shared with the workspace's conversation drop target. */
export const SIDEBAR_CONVERSATION_DRAG_MIME = "application/x-omnigent-conversation";

export interface SidebarConversationDrag {
  id: string;
  label: string;
  project: string | null;
  isPinned: boolean;
  canManage: boolean;
}

export function writeSidebarConversationDrag(
  transfer: DataTransfer,
  conversation: Pick<SidebarConversationDrag, "id" | "label">,
) {
  transfer.setData(
    SIDEBAR_CONVERSATION_DRAG_MIME,
    JSON.stringify({ id: conversation.id, title: conversation.label }),
  );
  transfer.effectAllowed = "copyMove";
}
