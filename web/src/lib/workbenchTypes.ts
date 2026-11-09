/** A filesystem workspace has an identity independent of the chat using it. */
export interface WorkbenchWorkspace {
  id: string;
  root: string;
  host_id: string | null;
  target_kind: "host" | "runner" | "runneronly" | "sandbox";
  available?: boolean;
  capabilities: string[];
  permission_level?: number;
  generation?: string | null;
  source_session_id?: string | null;
}
