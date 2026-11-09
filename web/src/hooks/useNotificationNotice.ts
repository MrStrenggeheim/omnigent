import { useEffect, useRef } from "react";
import {
  getNotificationSnapshot,
  notify,
  hideNotification,
  updateNotification,
  type NotifyInput,
} from "@/lib/notifications";

function retire(id: string) {
  const entry = getNotificationSnapshot().entries.find((item) => item.id === id);
  if (!entry) return;
  updateNotification(id, {
    action: undefined,
    cancel: undefined,
    jsx: undefined,
    type: entry.type === "loading" ? "normal" : entry.type,
    progress: entry.progress ? { ...entry.progress, active: false } : undefined,
  });
  hideNotification(id);
}

/** Publish a view-owned notice; retain history but retire actions when its scope ends. */
export function useNotificationNotice(id: string, input: NotifyInput | null, revealKey = ""): void {
  const previous = useRef({ id: "", active: false, revealKey: "" });
  useEffect(() => {
    const reveal =
      previous.current.id !== id ||
      !previous.current.active ||
      previous.current.revealKey !== revealKey;
    previous.current = { id, active: input !== null, revealKey };
    if (!input) {
      retire(id);
      return;
    }
    if (getNotificationSnapshot().entries.some((entry) => entry.id === id)) {
      updateNotification(
        id,
        {
          ...input,
          action: input.action,
          cancel: input.cancel,
          progress: input.progress,
          jsx: input.jsx,
          duration: input.duration,
        },
        { reveal },
      );
    } else if (reveal) {
      notify({ ...input, id });
    }
  }, [id, input, revealKey]);
  useEffect(
    () => () => {
      if (previous.current.id === id) previous.current.active = false;
      retire(id);
    },
    [id],
  );
}
