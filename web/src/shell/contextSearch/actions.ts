import {
  CalendarClockIcon,
  InboxIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SettingsIcon,
  SquarePenIcon,
  type LucideIcon,
} from "lucide-react";

export interface ActionCommand {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords: string[];
  run: () => void;
}

export function searchActions({
  navigate,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: {
  navigate: (path: string) => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}): ActionCommand[] {
  return [
    {
      id: "new-chat",
      label: "New chat",
      icon: SquarePenIcon,
      keywords: ["compose", "start", "new session"],
      run: () => navigate("/"),
    },
    {
      id: "go-inbox",
      label: "Go to Inbox",
      icon: InboxIcon,
      keywords: ["notifications", "comments", "needs response"],
      run: () => navigate("/inbox"),
    },
    {
      id: "go-tasks",
      label: "Go to Automations",
      icon: CalendarClockIcon,
      keywords: ["scheduled", "recurring", "cron", "automation", "schedule"],
      run: () => navigate("/tasks"),
    },
    {
      id: "go-settings",
      label: "Go to Settings",
      icon: SettingsIcon,
      keywords: ["preferences", "configuration", "account"],
      run: () => navigate("/settings"),
    },
    {
      id: "toggle-left-sidebar",
      label: "Toggle conversations sidebar",
      icon: PanelLeftIcon,
      keywords: ["panel", "left", "sessions list"],
      run: onToggleLeftSidebar,
    },
    {
      id: "toggle-right-sidebar",
      label: "Toggle workspace sidebar",
      icon: PanelRightIcon,
      keywords: ["panel", "right", "files", "terminal"],
      run: onToggleRightSidebar,
    },
  ];
}

export function filterSearchActions(
  actions: readonly ActionCommand[],
  query: string,
): ActionCommand[] {
  const normalized = query.trim().toLowerCase();
  return actions.filter(
    (action) =>
      !normalized ||
      [action.label, ...action.keywords].some((text) => text.toLowerCase().includes(normalized)),
  );
}
