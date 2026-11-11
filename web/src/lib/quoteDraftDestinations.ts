import { readReferenceDraft, writeReferenceDraft } from "./contextReferenceDrafts";
import { referenceSourceUrl, type ContextReference } from "./contextReferences";
import { getSessionDraft, setSessionDraft } from "./sessionDrafts";
import { useChatStore } from "@/store/chatStore";
import { serializeReplyDraft, snapshotReplyDraft, restoreReplyDraft } from "./replyDraft";

const destinations = new Map<string, (text: string) => void>();
export function registerQuoteDestination(id: string, insert: (text: string) => void): () => void {
  destinations.set(id, insert);
  return () => {
    if (destinations.get(id) === insert) destinations.delete(id);
  };
}
export function appendDraftText(text: string, addition: string): string {
  return text ? `${text}\n\n${addition}\n\n` : `${addition}\n\n`;
}
/** Insert only; this module never sends or changes conversation parentage. */
export function insertQuoteDraft(id: string, text: string): void {
  const mounted = destinations.get(id);
  if (mounted) {
    mounted(text);
    return;
  }
  const existing = getSessionDraft(id);
  const side = useChatStore.getState().sideChatComposers[id];
  const draft = side ?? restoreReplyDraft(existing?.text ?? "", existing?.replyDraft);
  const next = {
    ...draft,
    quotes: draft.quotes ?? [],
    text: appendDraftText(draft.text, text),
    files: side?.files ?? existing?.files ?? [],
  };
  setSessionDraft(id, {
    text: serializeReplyDraft(next),
    replyDraft: snapshotReplyDraft(next),
    files: next.files,
  });
  useChatStore.getState().updateSideChatComposer(id, () => next);
}

/** Keep exact context in an inspectable chip and the selected quote readable in the draft. */
export function insertQuoteReference(id: string, reference: ContextReference): void {
  const current = readReferenceDraft(id);
  writeReferenceDraft(id, [
    ...current.filter((item) => item.snapshot_id !== reference.snapshot_id),
    reference,
  ]);
  const quote = (reference.quote ?? "")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  insertQuoteDraft(
    id,
    `${quote}\n\n[Open source](${referenceSourceUrl(reference.source_id, reference.boundary_id)})`,
  );
}
