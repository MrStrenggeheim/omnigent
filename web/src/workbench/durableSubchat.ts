import { LIVE_ITEM_PREFIX } from "@/lib/blocks";
import { forkSession } from "@/lib/sessionsApi";
import { setSessionDraft, type SessionDraft } from "@/lib/sessionDrafts";
import { readReferenceDraft, writeReferenceDraft } from "@/lib/contextReferenceDrafts";
import type { WorkbenchActions } from "./WorkbenchContext";

const pendingSources = new Set<string>();

/** Ignore ephemeral stream chunks and delegated blocks when capturing the visible boundary. */
export function subchatBoundary(
  blocks: readonly { ctx: { itemId: string | null; depth: number } }[],
) {
  return (
    blocks.findLast((block) => {
      const id = block.ctx.itemId;
      return (
        block.ctx.depth === 0 &&
        !!id &&
        ![LIVE_ITEM_PREFIX, "pending:", "temp:"].some((prefix) => id.startsWith(prefix)) &&
        !id.endsWith(":user") &&
        !id.endsWith(":answer")
      );
    })?.ctx.itemId ?? undefined
  );
}

/** Fork immediately; seed an ordinary unsent draft before opening its conversation view. */
export function openDurableSubchat({
  sourceId,
  boundaryId,
  draft,
  openConversation,
}: {
  sourceId: string;
  boundaryId?: string;
  draft: SessionDraft;
  openConversation: WorkbenchActions["openConversation"];
}): Promise<string> | null {
  if (pendingSources.has(sourceId)) return null;
  const snapshot: SessionDraft = {
    text: draft.text,
    files: [...draft.files],
    ...(draft.replyDraft
      ? {
          replyDraft: {
            ...draft.replyDraft,
            quotes: draft.replyDraft.quotes.map((quote) => ({ ...quote })),
          },
        }
      : {}),
  };
  const references = readReferenceDraft(sourceId);
  pendingSources.add(sourceId);
  const task = (async () => {
    const child = await forkSession(sourceId, {
      title: "Subchat",
      ...(boundaryId ? { upToItemId: boundaryId } : {}),
    });
    setSessionDraft(child.id, snapshot);
    if (references.length) writeReferenceDraft(child.id, references);
    openConversation(child.id, { beside: true });
    return child.id;
  })();
  void task.then(
    () => pendingSources.delete(sourceId),
    () => pendingSources.delete(sourceId),
  );
  return task;
}
