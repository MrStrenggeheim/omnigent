import { BotIcon } from "lucide-react";
import { Link, useLocation } from "@/lib/routing";
import { sessionNavigationSearch } from "@/lib/sessionNavigation";
import { readSubagentActivity } from "@/lib/subagentActivity";
import { ActivityRow } from "@/components/ActivityRow";

export function SubagentActivityMessage({ data }: { data: Record<string, unknown> }) {
  const { search } = useLocation();
  const activity = readSubagentActivity(data);
  if (!activity) return null;
  const params = new URLSearchParams(sessionNavigationSearch(search));
  params.set("panel", "agents");
  const to = {
    pathname: `/c/${encodeURIComponent(activity.sessionId)}`,
    search: `?${params.toString()}`,
  };
  let label = activity.phase === "delegated" ? "Started" : "Completed";
  if (activity.phase === "returned") {
    if (activity.status === "failed") label = "Failed";
    if (["cancelled", "killed", "stopped"].includes(activity.status ?? "")) label = "Stopped";
  }
  return (
    <div
      className="not-prose w-full text-sm text-muted-foreground"
      data-testid="subagent-activity"
      data-phase={activity.phase}
      data-child-session-id={activity.sessionId}
    >
      <ActivityRow
        icon={<BotIcon aria-hidden="true" className="size-3.5" />}
        title={
          <>
            {label}{" "}
            <Link
              to={to}
              className="rounded-sm font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {activity.title}
            </Link>
          </>
        }
      />
    </div>
  );
}
