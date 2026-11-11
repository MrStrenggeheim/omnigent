import { filterSearchActions } from "@/shell/contextSearch/actions";
import { SearchIcon } from "lucide-react";
import { expect, it, vi } from "vitest";
import { FALLBACK_SERVER_INFO } from "@/lib/capabilities";
import { mergePaletteCommands, paletteWorkflowActions } from "./paletteCommands";

it("opens existing settings and automation workflows only when invoked", () => {
  const navigate = vi.fn(),
    projects = vi.fn();
  const commands = paletteWorkflowActions({
    navigate,
    onOpenProjects: projects,
    isAdmin: true,
    isDesktop: true,
    isMobile: false,
    info: {
      ...FALLBACK_SERVER_INFO,
      login_url: "/login",
      enabled_connections: ["github", "mcp"],
      agent_install: true,
      features: { custom_agents_settings_ui: true, usage_page: true },
    },
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(projects).not.toHaveBeenCalled();
  for (const section of [
    "account",
    "appearance",
    "harnesses",
    "custom-agents",
    "integrations",
    "mcp",
    "git",
    "shortcuts",
    "import",
    "archived",
    "members",
    "policies",
    "sharing",
    "cli",
    "updates",
  ]) {
    commands.find((command) => command.id === `settings:${section}`)!.run();
    expect(navigate).toHaveBeenLastCalledWith(`/settings/${section}`);
  }
  commands.find((command) => command.id === "go-tasks")!.run();
  expect(navigate).toHaveBeenLastCalledWith("/tasks");
  commands.find((command) => command.id === "go-projects")!.run();
  expect(projects).toHaveBeenCalledOnce();
});

it("uses the settings capability, identity, platform and mobile gates", () => {
  const commands = paletteWorkflowActions({
    navigate: vi.fn(),
    info: { ...FALLBACK_SERVER_INFO, single_user: true },
    isAdmin: false,
    isDesktop: false,
    isMobile: true,
  });
  const ids = commands.map((command) => command.id);
  expect(ids).toContain("settings:appearance");
  expect(ids).toContain("settings:harnesses");
  for (const hidden of [
    "account",
    "custom-agents",
    "integrations",
    "mcp",
    "members",
    "policies",
    "sharing",
    "shortcuts",
    "cli",
    "updates",
  ])
    expect(ids).not.toContain(`settings:${hidden}`);
  expect(ids).not.toContain("go-projects");
  expect(ids).not.toContain("go-usage");
});

it("keeps supplied view callbacks authoritative when merging the inventory", () => {
  const defaults = paletteWorkflowActions({
    navigate: vi.fn(),
    info: FALLBACK_SERVER_INFO,
    isAdmin: false,
    isDesktop: false,
    isMobile: false,
  });
  const captured = { ...defaults[0], run: vi.fn() };
  const merged = mergePaletteCommands([captured, captured], defaults);
  expect(merged.filter((command) => command.id === captured.id)).toEqual([captured]);
  expect(captured.run).not.toHaveBeenCalled();
  merged[0].run();
  expect(captured.run).toHaveBeenCalledOnce();
});

it("finds file operations and comments through existing Explorer/Changes workflows without mutations", () => {
  const explorer = {
    id: "open-files",
    label: "Explorer",
    icon: SearchIcon,
    keywords: ["open", "view"],
    run: vi.fn(),
  };
  const changes = {
    id: "open-changes",
    label: "Changes",
    icon: SearchIcon,
    keywords: ["open", "view"],
    run: vi.fn(),
  };
  const commands = mergePaletteCommands([explorer, changes], []);
  for (const keyword of ["upload", "download", "rename", "trash"])
    expect(filterSearchActions(commands, keyword).map((command) => command.id)).toEqual([
      "open-files",
    ]);
  expect(filterSearchActions(commands, "compare").map((command) => command.id)).toEqual([
    "open-changes",
  ]);
  expect(filterSearchActions(commands, "comments").map((command) => command.id)).toEqual([
    "open-files",
    "open-changes",
  ]);
  expect(explorer.keywords).toEqual(["open", "view"]);
  expect(explorer.run).not.toHaveBeenCalled();
  expect(changes.run).not.toHaveBeenCalled();
  commands[0].run();
  expect(explorer.run).toHaveBeenCalledOnce();
  expect(mergePaletteCommands([], [])).toEqual([]);
});
