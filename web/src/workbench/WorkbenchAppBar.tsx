import {
  Columns2Icon,
  LayoutTemplateIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeaderActionButton } from "@/components/HeaderActionButton";
import { MOD_KEY } from "@/components/KeyboardShortcut";
import { NotificationBell } from "@/components/NotificationCenter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OmnigentLogo } from "@/components/OmnigentLogo";

export interface WorkbenchOpenAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  disabled?: boolean;
}

export function WorkbenchAppBar({
  sidebarOpen,
  onToggleSidebar,
  onSearch,
  onSettings,
  openActions,
  onSaveLayout,
  onSharedLayout,
  layoutOwner,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSearch: () => void;
  onSettings: () => void;
  openActions: WorkbenchOpenAction[];
  onSaveLayout?: () => void;
  onSharedLayout: () => void;
  layoutOwner?: string;
}) {
  return (
    <header
      className="workbench-app-bar flex h-12 min-h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2"
      aria-label="Application"
    >
      <HeaderActionButton
        aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
        tooltipShortcut={[MOD_KEY, "B"]}
        onClick={onToggleSidebar}
      >
        <PanelLeftIcon
          className="size-4"
          fill={sidebarOpen ? "currentColor" : "none"}
          fillOpacity={sidebarOpen ? 0.15 : 1}
        />
      </HeaderActionButton>
      <OmnigentLogo className="size-7 shrink-0" />
      <span className="hidden text-sm font-semibold sm:block">Omnigent</span>
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        onClick={onSearch}
        className="h-6 min-w-0 gap-2 text-muted-foreground max-md:size-11 max-md:p-0 md:w-[min(34vw,30rem)] md:justify-start"
        aria-label="Search or run a command"
      >
        <SearchIcon className="size-3.5" />
        <span className="hidden truncate md:block">Search or run a command…</span>
      </Button>
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 max-md:size-11"
            aria-label="Open view"
          >
            <PlusIcon className="size-4" />
            <span className="hidden md:inline">Open</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Open</DropdownMenuLabel>
          {openActions.map((action) => (
            <DropdownMenuItem key={action.id} disabled={action.disabled} onSelect={action.run}>
              <action.icon className="size-4" />
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <HeaderActionButton aria-label="Layout">
            <Columns2Icon className="size-4" />
          </HeaderActionButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            {layoutOwner ? `Layout for ${layoutOwner}` : "Shared layout"}
          </DropdownMenuLabel>
          <DropdownMenuItem disabled={!onSaveLayout} onSelect={onSaveLayout}>
            <LayoutTemplateIcon className="size-4" />
            Save layout for this chat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSharedLayout}>
            <Columns2Icon className="size-4" />
            Use shared layout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NotificationBell />
      <HeaderActionButton aria-label="Settings" onClick={onSettings}>
        <SettingsIcon className="size-4" />
      </HeaderActionButton>
    </header>
  );
}
