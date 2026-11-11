import { getOmnigentServerIdentity } from "./host";
import { getCurrentUserId } from "./identity";

const PREFIX = "omnigent:resource-views:v1:";
const MAX_ENTRIES = 500;
const MAX_BYTES = 256_000;
const stores = new Map<string, Map<string, unknown>>();

/** Reuse the host's server identity; an unresolved account is memory-only. */
export function resourceViewStorageScope(): string {
  return JSON.stringify([getOmnigentServerIdentity(), getCurrentUserId()]);
}
function storageKey() {
  return getOmnigentServerIdentity() && getCurrentUserId()
    ? PREFIX + resourceViewStorageScope()
    : null;
}
function encode(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    item instanceof Set ? { resourceViewSet: [...item] } : item,
  );
}
function store() {
  const scope = resourceViewStorageScope();
  let values = stores.get(scope);
  if (values) return values;
  values = new Map();
  const key = storageKey();
  try {
    const raw = key ? localStorage.getItem(key) : null;
    if (raw && raw.length <= MAX_BYTES) {
      const entries: unknown = JSON.parse(raw, (_key, item) =>
        item && typeof item === "object" && Array.isArray(item.resourceViewSet)
          ? new Set(item.resourceViewSet)
          : item,
      );
      if (Array.isArray(entries)) {
        for (const entry of entries.slice(-MAX_ENTRIES)) {
          if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string")
            values.set(entry[0], entry[1]);
        }
      }
    }
  } catch {
    // Corrupt or unavailable browser storage leaves this account's memory usable.
  }
  stores.set(scope, values);
  if (stores.size > 8) stores.delete(stores.keys().next().value!);
  return values;
}
export function readResourceViewState<T>(key: string): T | undefined {
  return store().get(key) as T | undefined;
}
export function writeResourceViewState(key: string, value: unknown): boolean {
  const values = store();
  values.delete(key);
  if (value !== undefined) values.set(key, value);
  while (values.size > MAX_ENTRIES) values.delete(values.keys().next().value!);
  try {
    let encoded = encode([...values]);
    while (encoded.length > MAX_BYTES && values.size) {
      values.delete(values.keys().next().value!);
      encoded = encode([...values]);
    }
    const target = storageKey();
    if (!target) return false;
    localStorage.setItem(target, encoded);
    return true;
  } catch {
    // Live view state remains available when storage is blocked or full.
    return false;
  }
}
