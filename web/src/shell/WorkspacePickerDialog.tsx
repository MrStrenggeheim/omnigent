import { WorkspaceSelectionDialog } from "./WorkspaceSelectionDialog";

export interface WorkspacePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (path: string) => void | boolean | Promise<void | boolean>;
  onCancel?: () => void;
  hostId: string | null;
  initialPath?: string;
  workspacePath?: string;
  occupancyForPath?: (absolutePath: string) => number;
  title?: string;
  description?: string;
}

/** Path-only compatibility API; its execution host stays fixed. */
export function WorkspacePickerDialog({ onConfirm, ...props }: WorkspacePickerDialogProps) {
  return (
    <WorkspaceSelectionDialog
      {...props}
      allowHostChange={false}
      onConfirm={({ path }) => onConfirm(path)}
    />
  );
}
