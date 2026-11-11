import { useEffect, useRef, useState, type RefObject } from "react";

/** Roll back rejected URLs so the same destination can be requested again. */
export function useAcceptedConversationRoute({
  active,
  conversationId,
  href,
  scopeKey,
  skip,
  accept,
  onAccepted,
  navigate,
  onError,
}: {
  active: boolean;
  conversationId?: string;
  href: string;
  scopeKey: string;
  skip: RefObject<string | null>;
  accept: (id: string) => Promise<boolean>;
  onAccepted: (id: string) => void;
  navigate: (url: string, options: { replace: boolean }) => void;
  onError: (error: unknown) => void;
}) {
  const lastAccepted = useRef(href);
  const acceptedScope = useRef<string | null>(null);
  const [acceptedHref, setAcceptedHref] = useState<string | null>(null);
  useEffect(() => {
    if (!active || (acceptedScope.current === scopeKey && lastAccepted.current === href)) return;
    let cancelled = false;
    const accepted = () => {
      lastAccepted.current = href;
      acceptedScope.current = scopeKey;
      setAcceptedHref(href);
      if (conversationId) onAccepted(conversationId);
    };
    if (!conversationId || skip.current === conversationId) {
      skip.current = null;
      accepted();
      return;
    }
    skip.current = null;
    void accept(conversationId)
      .then((allowed) => {
        if (cancelled) return;
        if (allowed) accepted();
        else navigate(lastAccepted.current, { replace: true });
      })
      .catch((error) => {
        if (cancelled) return;
        navigate(lastAccepted.current, { replace: true });
        onError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [active, conversationId, href, scopeKey, skip, accept, onAccepted, navigate, onError]);
  return acceptedHref;
}
