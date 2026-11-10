import type { FileNavigationGuard } from "../FileViewerContext";

export interface SearchNavigationApproval {
  sessionId: string;
  workspaceId: string | null;
}

export function consumeSearchNavigationApproval(
  approval: SearchNavigationApproval | null,
  sessionId: string | undefined,
  workspaceId: string | null,
): boolean {
  return !!approval && approval.sessionId === sessionId && approval.workspaceId === workspaceId;
}

/** Commit only after the existing editor guards accept the actual destination. */
export function guardSearchNavigation(
  guards: readonly FileNavigationGuard[],
  workspaceId: string | null,
  apply: () => void,
): void {
  const proceed = (index: number) => {
    const guard = guards[index];
    if (guard) guard("", { workspaceId: workspaceId ?? "" }, () => proceed(index + 1));
    else apply();
  };
  proceed(0);
}
