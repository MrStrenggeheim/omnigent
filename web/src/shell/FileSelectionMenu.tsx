import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlusIcon, CornerDownLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEmbedRoot } from "@/lib/host";

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
  }, [x, y, source]);

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

  return createPortal(
    <div
      ref={menuRef}
      data-file-selection-menu
      data-add-comment-btn
      role="menu"
      aria-label="Selected text"
      className="fixed z-50 flex flex-wrap items-center gap-1 overflow-auto rounded-md bg-popover p-1 text-popover-foreground shadow-menu ring-1 ring-border"
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
      <Button
        type="button"
        role="menuitem"
        variant="ghost"
        size="sm"
        tabIndex={activeIndex === 0 || !source ? 0 : -1}
        onFocus={() => setActiveIndex(0)}
        onClick={() => {
          onComment();
          onClose();
        }}
      >
        <MessageSquarePlusIcon />
        Add comment
      </Button>
      {source && (
        <Button
          type="button"
          role="menuitem"
          variant="ghost"
          size="sm"
          tabIndex={activeIndex === 1 ? 0 : -1}
          onFocus={() => setActiveIndex(1)}
          onClick={() => {
            const text = getText();
            if (text.trim())
              window.dispatchEvent(
                new CustomEvent<FileAnnotation>(FILE_ANNOTATION_EVENT, {
                  detail: { ...source, text },
                }),
              );
            onClose();
            window.getSelection()?.removeAllRanges();
          }}
        >
          <CornerDownLeftIcon />
          Ask in chat
        </Button>
      )}
    </div>,
    getEmbedRoot() ?? document.body,
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
