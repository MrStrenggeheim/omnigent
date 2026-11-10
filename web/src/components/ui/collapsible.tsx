import * as React from "react";
import * as CollapsiblePrimitive from "radix-ui/collapsible";
import { ButtonTooltip } from "./tooltip";

const CollapsibleOpenContext = React.createContext(false);

function Collapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const expanded = open ?? internalOpen;
  return (
    <CollapsibleOpenContext.Provider value={expanded}>
      <CollapsiblePrimitive.Root
        data-slot="collapsible"
        {...props}
        open={expanded}
        onOpenChange={(next) => {
          setInternalOpen(next);
          onOpenChange?.(next);
        }}
      />
    </CollapsibleOpenContext.Provider>
  );
}

const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>
>(function CollapsibleTrigger({ title, children, ...props }, ref) {
  const expanded = React.useContext(CollapsibleOpenContext);
  const childLabel = React.isValidElement<{ "aria-label"?: string }>(children)
    ? children.props["aria-label"]
    : undefined;
  const label =
    props["aria-label"] ?? childLabel ?? (expanded ? "Collapse details" : "Expand details");
  return (
    <ButtonTooltip label={label} description={title}>
      <CollapsiblePrimitive.Trigger
        ref={ref}
        data-slot="collapsible-trigger"
        {...props}
        data-state={expanded ? "open" : "closed"}
      >
        {children}
      </CollapsiblePrimitive.Trigger>
    </ButtonTooltip>
  );
});

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props} />;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
