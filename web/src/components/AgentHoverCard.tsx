import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AvailableAgent } from "@/hooks/useAvailableAgents";

/** Read-only agent guidance shares the button tooltip, including keyboard focus. */
export function AgentHoverCard({
  agent,
  children,
}: {
  agent: AvailableAgent;
  children: ReactNode;
}) {
  if (!agent.description) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent description={agent.description} data-testid={`agent-hover-card-${agent.id}`}>
        {agent.display_name}
      </TooltipContent>
    </Tooltip>
  );
}

/** Menu callers retain ownership of the menu item's ref and selection handlers. */
export const AgentRowTooltip = AgentHoverCard;
