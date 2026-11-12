import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { getEmbedRoot } from "@/lib/host";

export const textSelectionMenuClassName =
  "selectionmenu slim-scrollbar fixed z-50 overflow-auto rounded-md bg-popover text-popover-foreground shadow-menu ring-1 ring-border";

export interface TextSelectionAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  closeOnSelect?: boolean;
}

export function TextSelectionMenu({
  x,
  y,
  actions,
  onClose,
  ...props
}: Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  x: number;
  y: number;
  actions: TextSelectionAction[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useLayoutEffect(() => {
    const position = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 8;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const width = Math.max(0, (viewport?.width ?? window.innerWidth) - 16);
      const height = Math.max(0, (viewport?.height ?? window.innerHeight) - 16);
      menu.style.maxWidth = `${width}px`;
      menu.style.maxHeight = `${height}px`;
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(left, Math.min(x, left + width - rect.width))}px`;
      menu.style.top = `${Math.max(top, Math.min(y - rect.height, top + height - rect.height))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [x, y, actions.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  // Panel containment changes the fixed-position origin; use the viewport.
  return createPortal(
    <div
      ref={menuRef}
      {...props}
      data-text-selection-menu
      role="menu"
      aria-label="Selected text"
      className={`${textSelectionMenuClassName} flex flex-wrap items-center gap-1 p-1`}
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        );
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: number;
        switch (event.key) {
          case "ArrowRight":
          case "ArrowDown":
            next = (current + 1) % items.length;
            break;
          case "ArrowLeft":
          case "ArrowUp":
            next = (current - 1 + items.length) % items.length;
            break;
          case "Home":
            next = 0;
            break;
          case "End":
            next = items.length - 1;
            break;
          default:
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        items[next]?.focus({ preventScroll: true });
      }}
    >
      {actions.map((action, index) => (
        <Button
          key={action.label}
          type="button"
          role="menuitem"
          variant="ghost"
          size="sm"
          tabIndex={Math.min(activeIndex, actions.length - 1) === index ? 0 : -1}
          onFocus={() => setActiveIndex(index)}
          onClick={() => {
            action.onSelect();
            if (action.closeOnSelect !== false) onClose();
          }}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
    </div>,
    getEmbedRoot() ?? document.body,
  );
}
