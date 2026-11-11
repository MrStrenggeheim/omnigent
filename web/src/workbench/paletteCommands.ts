import { CalendarClockIcon, FolderKanbanIcon, SearchIcon, type LucideIcon } from "lucide-react";
import type { ActionCommand } from "@/shell/contextSearch/actions";
import { settingsNavGroups } from "@/shell/settingsNav";
import {
  customAgentsSettingsEnabled,
  isFeatureEnabled,
  isSingleUserMode,
  type ServerInfo,
} from "@/lib/capabilities";
import type { WorkbenchWorkspace } from "@/lib/workbenchWorkspace";

export interface CommandPaletteFileTarget {
  workspace?: WorkbenchWorkspace;
  conversationId?: string;
  folder?: string;
}

const settingsKeywords: Record<string, string[]> = {
  appearance: ["theme", "color", "density", "font"],
  general: ["defaults", "model", "agent", "preferences"],
  harnesses: ["agents", "models", "machines", "hosts", "plugins"],
  "custom-agents": ["agents", "install", "create agent"],
  integrations: ["integrations", "connections", "credentials", "providers"],
  mcp: ["integrations", "tools", "servers", "connections"],
  git: ["github", "gitlab", "azure", "repositories"],
  account: ["account", "profile", "password", "sign out"],
  import: ["import", "history", "sessions"],
  archived: ["archive", "restore", "sessions"],
  shortcuts: ["keyboard", "hotkeys"],
};

/** Open the existing feature surfaces; mutations stay in their owning workflows. */
export function paletteWorkflowActions({
  navigate,
  info,
  isAdmin,
  isDesktop,
  isMobile,
  onOpenProjects,
}: {
  navigate: (path: string) => void;
  info: ServerInfo | "loading";
  isAdmin: boolean;
  isDesktop: boolean;
  isMobile: boolean;
  onOpenProjects?: () => void;
}): ActionCommand[] {
  const connections = info === "loading" ? [] : (info.enabled_connections ?? []);
  const groups = settingsNavGroups(
    info !== "loading" && !!info.login_url,
    isDesktop,
    isAdmin,
    isSingleUserMode(info),
    connections.some((provider) => provider !== "mcp"),
    customAgentsSettingsEnabled(info),
    connections.includes("mcp"),
  );
  const result: ActionCommand[] = groups.flatMap((group) =>
    group.items
      .filter((item) => !isMobile || !item.hideOnMobile)
      .map((item) => ({
        id: `settings:${item.id}`,
        label: `Settings: ${item.label}`,
        icon: item.icon,
        keywords: ["settings", ...(settingsKeywords[item.id] ?? [])],
        run: () => navigate(`/settings/${item.id}`),
      })),
  );
  const route = (id: string, label: string, path: string, icon: LucideIcon, keywords: string[]) =>
    result.push({ id, label, icon, keywords, run: () => navigate(path) });
  route("go-tasks", "Go to Automations", "/tasks", CalendarClockIcon, [
    "automations",
    "schedule",
    "cron",
    "runs",
  ]);
  if (isFeatureEnabled(info, "usage_page"))
    route("go-usage", "Usage and costs", "/usage", SearchIcon, ["tokens", "spending", "usage"]);
  if (onOpenProjects)
    result.push({
      id: "go-projects",
      label: "Open Projects",
      icon: FolderKanbanIcon,
      keywords: ["projects", "organize", "folders", "new project"],
      run: onOpenProjects,
    });
  return result;
}

const workflowKeywords: Record<string, readonly string[]> = {
  "open-files": [
    "upload",
    "download",
    "rename",
    "trash",
    "delete",
    "restore",
    "comments",
    "annotations",
  ],
  "open-changes": ["compare", "comparison", "diff", "revisions", "comments"],
};

/** Parent commands override built-ins with the same id, including target-specific actions. */
export function mergePaletteCommands(
  primary: readonly ActionCommand[],
  workflows: readonly ActionCommand[],
): ActionCommand[] {
  const result = new Map<string, ActionCommand>();
  for (const command of [...primary, ...workflows])
    if (!result.has(command.id)) {
      const keywords = workflowKeywords[command.id];
      result.set(
        command.id,
        keywords
          ? { ...command, keywords: [...new Set([...command.keywords, ...keywords])] }
          : command,
      );
    }
  return [...result.values()];
}
