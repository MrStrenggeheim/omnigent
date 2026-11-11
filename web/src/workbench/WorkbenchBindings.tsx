import { useEffect } from "react";
import type { Conversation } from "@/hooks/useConversations";
import { useIdleNotifications } from "@/hooks/useIdleNotifications";
import { useSeedReadState } from "@/hooks/useUnseenConversations";
import { useIOSViewportLock } from "@/hooks/useIOSViewportLock";
import { useListDensity } from "@/lib/listDensityPreferences";
import { useContextualFindHotkey } from "@/hooks/useContextualFindHotkey";
import { useCommandPaletteHotkey } from "@/hooks/useCommandPaletteHotkey";
import { useSidebarToggleHotkeys } from "@/hooks/useSidebarToggleHotkeys";
import { useManualTerminalHotkey, useNewShellHotkey } from "@/hooks/useNewShellHotkey";
import { useNewSessionHotkey } from "@/hooks/useNewSessionHotkey";
import { useSettingsHotkey } from "@/hooks/useSettingsHotkey";
import { useApproveHotkey } from "@/hooks/useApproveHotkey";
import { hasCommandModifier } from "@/lib/hotkeys";
import { supportsBrowser, onNativeSidebarDrag } from "@/lib/nativeBridge";
import { onInAppLinkOpen } from "@/lib/openLinkInApp";
import { onBrowserActionRequest } from "@/lib/browserActionBus";

/** Mounted only by the active shell; retained editors do not own global bindings. */
export function WorkbenchBindings({
  conversationId,
  approvalConversationId,
  conversations,
  onChatFind,
  onExplorerFind,
  onTogglePalette,
  onSessionSearch,
  onToggleSidebar,
  onOpenFiles,
  onOpenTerminal,
  onNewTerminal,
  onSidebarDrag,
  onOpenBrowser,
}: {
  conversationId?: string;
  approvalConversationId: string | null;
  conversations: Conversation[];
  onChatFind: (scope: "current" | "all") => void;
  onExplorerFind: (replace?: boolean) => void;
  onTogglePalette: () => void;
  onSessionSearch: () => void;
  onToggleSidebar: () => void;
  onOpenFiles: () => void;
  onOpenTerminal: () => void;
  onNewTerminal: () => void;
  onSidebarDrag: Parameters<typeof onNativeSidebarDrag>[0];
  onOpenBrowser: (id: string) => void;
}) {
  useIOSViewportLock();
  useListDensity();
  useIdleNotifications(conversationId);
  useSeedReadState(conversations);
  useContextualFindHotkey({ onChatFind, onExplorerFind });
  useCommandPaletteHotkey(onTogglePalette, true, undefined, onSessionSearch);
  useSidebarToggleHotkeys({ onToggleLeft: onToggleSidebar, onToggleRight: onOpenFiles });
  useManualTerminalHotkey(onOpenTerminal);
  useNewShellHotkey(onNewTerminal);
  useNewSessionHotkey();
  useSettingsHotkey();
  useApproveHotkey(undefined, approvalConversationId);
  useEffect(() => onNativeSidebarDrag(onSidebarDrag), [onSidebarDrag]);
  useEffect(() => {
    if (!supportsBrowser()) return;
    const removeLink = onInAppLinkOpen(onOpenBrowser);
    const removeAction = onBrowserActionRequest((event, id) => {
      if (event.action === "navigate" && id) onOpenBrowser(id);
    });
    return () => {
      removeLink();
      removeAction();
    };
  }, [onOpenBrowser]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        !event.shiftKey ||
        !hasCommandModifier(event) ||
        !["KeyF", "KeyH"].includes(event.code)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onExplorerFind(event.code === "KeyH");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onExplorerFind]);
  return null;
}
