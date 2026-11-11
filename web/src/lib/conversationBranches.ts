import type { Conversation } from "@/hooks/useConversations";

export interface ConversationBranch {
  source_conversation_id: string;
  root_conversation_id?: string | null;
  source_item_id?: string | null;
  source_response_id?: string | null;
  inherited_item_count?: number | null;
  inherited_last_item_id?: string | null;
  created_at?: number | null;
  reference_only: boolean;
  recovery: "replay" | "legacy_unknown" | "unavailable";
}
export type BranchConversation = Conversation & { branch?: ConversationBranch | null };

/** Branch provenance is independent of delegation parent/root fields. */
export function branchSource(row: Conversation): string | undefined {
  const source = (row as BranchConversation).branch?.source_conversation_id;
  return typeof source === "string" && source && source !== row.id ? source : undefined;
}

/** Keep an orphan visible; never invent an inaccessible ancestor's row or title. */
export function branchRoots(rows: readonly Conversation[]): Conversation[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.filter((row) => {
    const source = branchSource(row);
    if (!source || !byId.has(source)) return true;
    const seen = new Set([row.id]);
    let ancestor: Conversation | undefined = byId.get(source);
    while (ancestor) {
      if (seen.has(ancestor.id)) return true;
      seen.add(ancestor.id);
      ancestor = byId.get(branchSource(ancestor) ?? "");
    }
    return false;
  });
}
export function branchChildren(rows: readonly Conversation[], parentId: string): Conversation[] {
  return rows.filter((row) => branchSource(row) === parentId);
}
export function visibleBranchRows(
  roots: readonly Conversation[],
  rows: readonly Conversation[],
  expanded: ReadonlySet<string>,
): Conversation[] {
  const result: Conversation[] = [];
  const visited = new Set<string>();
  function visit(row: Conversation) {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    result.push(row);
    if (expanded.has(row.id)) for (const child of branchChildren(rows, row.id)) visit(child);
  }
  for (const row of branchRoots(roots)) visit(row);
  return result;
}
