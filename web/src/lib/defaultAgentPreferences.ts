export const DEFAULT_AGENT_STORAGE_KEY = "omnigent:default-agent-id";

/** Explicit browser default; independent of the composer's last-used agent. */
export function readDefaultAgentId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DEFAULT_AGENT_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** Return false on storage failure so Settings can keep the previous selection. */
export function writeDefaultAgentId(agentId: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const value = agentId?.trim();
    if (value) window.localStorage.setItem(DEFAULT_AGENT_STORAGE_KEY, value);
    else window.localStorage.removeItem(DEFAULT_AGENT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
