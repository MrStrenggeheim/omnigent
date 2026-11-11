import { useEffect, useState, type ReactNode } from "react";

/** Retain live buffers after the first visit while a legacy Canvas/Grid route is visible. */
export function RetainedWorkbench({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  if (!active && !visited) return null;
  return (
    <div
      className={active ? "contents" : "hidden"}
      hidden={!active}
      ref={(node) => {
        node?.toggleAttribute("inert", !active);
      }}
      aria-hidden={!active || undefined}
    >
      {children}
    </div>
  );
}
