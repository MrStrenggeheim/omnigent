import { useEffect, useRef, useState } from "react";

import { useHostDbcert } from "@/hooks/useHostDbcert";
import { checkDbcert, refreshDbcert } from "@/lib/nativeBridge";
import { useNotificationNotice } from "@/hooks/useNotificationNotice";

/**
 * Warns that the dbcert on this session's host has expired and
 * offers a one-click refresh (see `useHostDbcert`). Styled like
 * `StreamBudgetBanner` and stacked with it in a `FloatingBannerStack`.
 * Dismissable per expired certificate.
 */
export function DbcertBanner({
  conversationId,
  hostId,
}: {
  conversationId: string | null | undefined;
  hostId: string | null | undefined;
}) {
  const dbcert = useHostDbcert(conversationId, hostId);
  if (!dbcert.show) return null;
  return (
    <DbcertRefreshBanner
      id={`host-dbcert:${conversationId}:${hostId}`}
      message={`The dbcert on ${dbcert.hostName || "this host"} has expired. Certain internal tools will fail until you refresh it.`}
      running={dbcert.phase === "running"}
      error={
        dbcert.phase === "failed"
          ? dbcert.refreshMode === "host"
            ? "Sign-in didn't complete. Try again, or run dbcert on the host."
            : "Couldn't refresh it from here. Click dbcert in the Arca Companion menu on your laptop."
          : null
      }
      onRefresh={dbcert.refresh}
      onDismiss={dbcert.dismiss}
    />
  );
}

export function LaptopDbcertBanner({
  onReady,
  onDismiss,
}: {
  onReady: () => void;
  onDismiss: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshAttemptRef = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      refreshAttemptRef.current = null;
    },
    [],
  );

  async function refresh() {
    if (refreshAttemptRef.current !== null) return;
    const attempt = Symbol();
    refreshAttemptRef.current = attempt;
    setRunning(true);
    setError(null);
    const result = await refreshDbcert({ skipArcaSync: true });
    if (refreshAttemptRef.current !== attempt) return;
    if (!result.ok) {
      setError(result.error);
    } else {
      const status = await checkDbcert();
      if (refreshAttemptRef.current !== attempt) return;
      if (!status.ok) setError(status.error);
      else if (!status.valid)
        setError("Your laptop's dbcert is still invalid after sign-in. Try refreshing it again.");
      else onReady();
    }
    refreshAttemptRef.current = null;
    setRunning(false);
  }

  return (
    <DbcertRefreshBanner
      id="laptop-dbcert"
      message="Your laptop's dbcert is missing or expired. Refresh it, then try again."
      running={running}
      error={error}
      onRefresh={refresh}
      onDismiss={onDismiss}
    />
  );
}

function DbcertRefreshBanner({
  id,
  message,
  running,
  error,
  onRefresh,
  onDismiss,
}: {
  id: string;
  message: string;
  running: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onDismiss: () => void;
}) {
  useNotificationNotice(
    id,
    {
      title: "Certificate needs attention",
      description: (
        <>
          <p>{message}</p>
          {running && <p>Opening browser sign-in. Complete sign-in to refresh your dbcert.</p>}
          {error && <p>{error}</p>}
        </>
      ),
      type: error ? "error" : "warning",
      progress: running ? { active: true, label: "Refreshing certificate" } : undefined,
      action: running
        ? undefined
        : {
            label: error ? "Try again" : "Refresh dbcert",
            onClick: async (event) => {
              event.preventDefault();
              await onRefresh();
            },
          },
      cancel: { label: "Dismiss warning", onClick: onDismiss },
    },
    error ?? "",
  );
  return null;
}
