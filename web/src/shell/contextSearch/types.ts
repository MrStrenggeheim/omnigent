export type ContextSearchScope = "current" | "all";
export type ContextSearchCategory = "all" | "messages" | "titles" | "actions";

export interface SearchRange {
  start: number;
  end: number;
}

export interface MessageSearchHit {
  session_id: string;
  title: string | null;
  item_id: string;
  role: string;
  created_at: number | null;
  text: string;
  text_start?: number;
  text_truncated?: boolean;
  content_hash: string;
  snippet: string;
  snippet_start: number;
  ranges: SearchRange[];
  occurrence_count: number;
}

export interface MessageSearchPage {
  data: MessageSearchHit[];
  has_more: boolean;
  next_cursor: string | null;
  total?: number;
}

export interface ContextSearchTarget {
  conversationId: string;
  itemId: string;
  range: SearchRange;
  sourceText: string;
  content_hash: string;
  textStart?: number;
  requestId?: number;
}

export interface SearchOccurrence {
  hit: MessageSearchHit;
  range: SearchRange;
}

export function occurrenceKey(occurrence: SearchOccurrence): string {
  return `${occurrence.hit.session_id}:${occurrence.hit.item_id}:${occurrence.range.start}`;
}

export function targetKey(target: ContextSearchTarget | null): string {
  return target ? `${target.conversationId}:${target.itemId}:${target.range.start}` : "";
}

export function searchOccurrences(hits: readonly MessageSearchHit[]): SearchOccurrence[] {
  return hits.flatMap((hit) => hit.ranges.map((range) => ({ hit, range })));
}

export function occurrenceTarget(
  occurrence: SearchOccurrence,
  requestId: number,
): ContextSearchTarget {
  return {
    conversationId: occurrence.hit.session_id,
    itemId: occurrence.hit.item_id,
    range: occurrence.range,
    sourceText: occurrence.hit.text,
    content_hash: occurrence.hit.content_hash,
    textStart: occurrence.hit.text_start,
    requestId,
  };
}
