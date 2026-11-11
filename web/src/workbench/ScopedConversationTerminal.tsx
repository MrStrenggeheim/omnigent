import { useCallback, useMemo, type ReactNode } from "react";
import { useSession } from "@/hooks/useSession";
import { isNativeTerminalSession } from "@/lib/nativeCodingAgents";
import { TerminalFirstContextProvider, type TerminalFirstView } from "@/shell/TerminalFirstContext";
import { useWorkbench } from "./WorkbenchContext";

/** Native behavior remains session-specific; terminals open as independent dock views. */
export function ScopedConversationTerminal({
  conversationId,
  children,
}: {
  conversationId: string;
  children: ReactNode;
}) {
  const { session } = useSession(conversationId);
  const workbench = useWorkbench();
  const setView = useCallback(
    (view: TerminalFirstView) => {
      if (view === "terminal") workbench?.openView({ kind: "agent-terminal", conversationId });
    },
    [conversationId, workbench],
  );
  const value = useMemo(
    () => ({
      isClaudeNative: session?.labels?.["omnigent.wrapper"] === "claude-code-native-ui",
      isNativeWrapper: isNativeTerminalSession(session),
      isTerminalFirst: false,
      isShellView: false,
      view: "chat" as const,
      setView,
      terminalViewKey: null,
      terminalsAvailable: false,
      terminalStartingUp: false,
    }),
    [session, setView],
  );
  return <TerminalFirstContextProvider value={value}>{children}</TerminalFirstContextProvider>;
}
