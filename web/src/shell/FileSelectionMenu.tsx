import { createContext, useContext, type ReactNode } from "react";
import { MessageSquarePlusIcon, CornerDownLeftIcon } from "lucide-react";
import { TextSelectionMenu, type TextSelectionAction } from "@/components/chat/TextSelectionMenu";

export const FILE_ANNOTATION_EVENT = "omnigent:ask-file-selection";
export interface FileAnnotation {
  conversationId: string;
  path: string;
  workspaceRoot: string | null;
  text: string;
}
export const FileSelectionContext = createContext<Omit<FileAnnotation, "text"> | null>(null);
export function FileSelectionMenu({
  x,
  y,
  onComment,
  getText,
  onClose,
}: {
  x: number;
  y: number;
  onComment: () => void;
  getText: () => string;
  onClose: () => void;
}) {
  const source = useContext(FileSelectionContext);
  const actions: TextSelectionAction[] = [
    { label: "Add comment", icon: <MessageSquarePlusIcon />, onSelect: onComment },
  ];
  if (source)
    actions.push({
      label: "Ask in chat",
      icon: <CornerDownLeftIcon />,
      onSelect: () => {
        const text = getText();
        if (text.trim())
          window.dispatchEvent(
            new CustomEvent<FileAnnotation>(FILE_ANNOTATION_EVENT, {
              detail: { ...source, text },
            }),
          );
        window.getSelection()?.removeAllRanges();
      },
    });
  return (
    <TextSelectionMenu
      x={x}
      y={y}
      actions={actions}
      onClose={onClose}
      data-file-selection-menu
      data-add-comment-btn
    />
  );
}

export function FileSelectionScope({
  value,
  children,
}: {
  value: Omit<FileAnnotation, "text">;
  children: ReactNode;
}) {
  return <FileSelectionContext.Provider value={value}>{children}</FileSelectionContext.Provider>;
}
