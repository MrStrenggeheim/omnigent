import { useNotificationNotice } from "@/hooks/useNotificationNotice";
import { useChatStore } from "@/store/chatStore";

export function StreamBudgetBanner() {
  const exceeded = useChatStore((s) => s.streamBudgetExceeded);
  const dismissed = useChatStore((s) => s.streamBudgetBannerDismissed);
  const dismiss = useChatStore((s) => s.dismissStreamBudgetBanner);
  useNotificationNotice(
    "stream-budget",
    exceeded && !dismissed
      ? {
          title: "Conversation stream capacity",
          description:
            "You have a lot of conversations open across your tabs. If you experience any slowness, please close a few tabs.",
          type: "warning",
          cancel: { label: "Dismiss warning", onClick: dismiss },
        }
      : null,
  );
  return null;
}
