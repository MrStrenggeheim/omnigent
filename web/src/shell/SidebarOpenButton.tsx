import { ArrowLeftIcon, PanelLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { SidebarPanelIcon, mobileSidebarToggleStyle } from "./SidebarToggle";
import { HeaderActionButton } from "@/components/HeaderActionButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobileViewport } from "@/hooks/useIsMobileViewport";

/** Shared collapsed-sidebar control for page and conversation headers. */
export function SidebarOpenButton({
  onOpenSidebar,
  settingsMode = false,
  componentId,
  size = "icon-xs",
}: {
  onOpenSidebar: (peek?: boolean) => void;
  settingsMode?: boolean;
  componentId: string;
  size?: "icon-xs" | "icon-sm";
}) {
  const isMobile = useIsMobileViewport();
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekRequest = useRef(0);
  const suppressTooltip = useRef(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const cancelPeek = useCallback(() => {
    peekRequest.current += 1;
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    suppressTooltip.current = false;
  }, []);
  const onPeekSidebar = useCallback(() => {
    // A mobile tap's synthetic pointerenter must not open a hover preview.
    if (isMobile) return;
    cancelPeek();
    const request = peekRequest.current;
    peekTimer.current = setTimeout(() => {
      peekTimer.current = null;
      if (peekRequest.current !== request) return;
      // The peek replaces the hover tooltip; keyboard focus still shows it.
      suppressTooltip.current = true;
      setTooltipOpen(false);
      onOpenSidebar(true);
    }, 400);
  }, [isMobile, onOpenSidebar, cancelPeek]);
  useEffect(() => cancelPeek, [cancelPeek]);

  const label = settingsMode ? "Back to settings menu" : "Open sidebar";
  const floating = isMobile && !settingsMode;
  const control = (
    <Tooltip
      open={tooltipOpen}
      onOpenChange={(next) => {
        if (next && suppressTooltip.current) return;
        setTooltipOpen(next);
      }}
    >
      <TooltipTrigger asChild>
        <HeaderActionButton
          type="button"
          variant="ghost"
          size={size}
          aria-label={label}
          aria-expanded={false}
          componentId={componentId}
          onClick={() => {
            cancelPeek();
            onOpenSidebar(false);
          }}
          // macOS uses the persistent titlebar cluster in place of this button.
          className={cn(
            "chat-header-sidebar-toggle pointer-events-auto border-none text-muted-foreground hover:text-foreground max-md:size-11",
            floating && "fixed z-[60]",
          )}
          style={floating ? mobileSidebarToggleStyle("left") : undefined}
          onPointerEnter={onPeekSidebar}
          onPointerDown={cancelPeek}
          onPointerLeave={cancelPeek}
        >
          {settingsMode ? (
            <ArrowLeftIcon className="size-4" />
          ) : isMobile ? (
            <SidebarPanelIcon side="left" />
          ) : (
            <PanelLeftIcon className="size-4" />
          )}
        </HeaderActionButton>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
  return floating ? (
    <>
      <span aria-hidden className="size-11 shrink-0" />
      {createPortal(control, document.body)}
    </>
  ) : (
    control
  );
}
