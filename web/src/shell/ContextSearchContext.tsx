import { createContext, useContext, type ReactNode } from "react";
import type { useContextSearchController } from "@/hooks/useContextSearchController";

export type ContextSearchController = ReturnType<typeof useContextSearchController>;
const ContextSearchContext = createContext<ContextSearchController | null>(null);

export function ContextSearchProvider({
  value,
  children,
}: {
  value: ContextSearchController;
  children: ReactNode;
}) {
  return <ContextSearchContext.Provider value={value}>{children}</ContextSearchContext.Provider>;
}

/** Optional so transcripts and side chats can render outside the app shell. */
export function useContextSearch(): ContextSearchController | null {
  return useContext(ContextSearchContext);
}

export type { ContextSearchTarget } from "./contextSearch/types";
