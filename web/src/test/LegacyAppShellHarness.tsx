import { GridSessionsProvider } from "@/grid/GridSessionsContext";
import { LegacyAppShell } from "@/shell/AppShell";

/** Exercise the retained Canvas/Grid shell independently of the default docked route. */
export function LegacyAppShellHarness() {
  return (
    <GridSessionsProvider>
      <LegacyAppShell />
    </GridSessionsProvider>
  );
}
