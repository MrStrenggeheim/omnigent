import { useCallback, useEffect, useRef, useState } from "react";
import { useViewerId } from "@/hooks/useViewerId";
import { getOmnigentServerIdentity } from "@/lib/host";

export interface ActivityAttentionScope {
  accountId: string;
  serverId: string;
  conversationId: string;
}

export interface ActivityAttentionMark {
  id: string;
  revision: string;
  disposition: "read" | "dismissed";
}

export function activityAttentionKey(scope: ActivityAttentionScope): string {
  return `omnigent:activity-attention:v1:${JSON.stringify([scope.accountId, scope.serverId, scope.conversationId])}`;
}

export function parseActivityAttention(raw: string | null): ActivityAttentionMark[] {
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (
    value?.version !== 1 ||
    !Array.isArray(value.marks) ||
    value.marks.some(
      (mark: ActivityAttentionMark) =>
        !mark ||
        typeof mark.id !== "string" ||
        typeof mark.revision !== "string" ||
        !["read", "dismissed"].includes(mark.disposition),
    )
  )
    throw new Error("Saved activity attention is invalid");
  return value.marks;
}

const changedEvent = "omnigent-activity-attention";

function readAttention(key: string | null) {
  try {
    return {
      key,
      marks: key ? parseActivityAttention(localStorage.getItem(key)) : [],
      error: null as Error | null,
    };
  } catch (cause) {
    return {
      key,
      marks: [] as ActivityAttentionMark[],
      error: cause instanceof Error ? cause : new Error(String(cause)),
    };
  }
}

/** Read/dismiss only affects this browser's attention state, never execution. */
export function useActivityAttention(conversationId: string | null) {
  const accountId = useViewerId();
  const serverId = getOmnigentServerIdentity();
  const key =
    accountId && serverId && conversationId
      ? activityAttentionKey({ accountId, serverId, conversationId })
      : null;
  const [state, setState] = useState(() => readAttention(key));
  const current = state.key === key ? state : readAttention(key);
  const latest = useRef(current);
  latest.current = current;
  if (state.key !== key) setState(current);
  useEffect(() => {
    const reload = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== key) return;
      if (event instanceof CustomEvent && event.detail !== key) return;
      setState(readAttention(key));
    };
    window.addEventListener("storage", reload);
    window.addEventListener(changedEvent, reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener(changedEvent, reload);
    };
  }, [key]);
  const mark = useCallback(
    (
      ids: { id: string; revision: string }[],
      disposition: ActivityAttentionMark["disposition"],
    ) => {
      if (!key || !ids.length) return;
      const previous = readAttention(key);
      const replaced = new Set(ids.map((item) => item.id));
      const base =
        latest.current.key === key && latest.current.error ? latest.current.marks : previous.marks;
      const marks = [
        ...base.filter((item) => !replaced.has(item.id)),
        ...ids.map(({ id, revision }) => ({ id, revision, disposition })),
      ];
      try {
        localStorage.setItem(key, JSON.stringify({ version: 1, marks }));
        window.dispatchEvent(new CustomEvent(changedEvent, { detail: key }));
        setState({ key, marks, error: null });
      } catch (cause) {
        setState({ key, marks, error: cause instanceof Error ? cause : new Error(String(cause)) });
      }
    },
    [key],
  );
  const disposition = (id: string, revision: string) =>
    current.marks.find((item) => item.id === id && item.revision === revision)?.disposition;
  return {
    scopeKey: key,
    disposition,
    markRead: (ids: { id: string; revision: string }[]) => mark(ids, "read"),
    dismiss: (ids: { id: string; revision: string }[]) => mark(ids, "dismissed"),
    error: current.error,
  };
}
