export const DEFAULT_MODELS_STORAGE_KEY = "omnigent:default-model-by-harness";

/** Missing means use the remembered choice; an empty string explicitly uses the harness default. */
export function readDefaultModels(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DEFAULT_MODELS_STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry) => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function readDefaultModel(harness: string | null | undefined): string | undefined {
  const value = harness ? readDefaultModels()[harness] : undefined;
  return typeof value === "string" ? value : undefined;
}

export function writeDefaultModel(harness: string, model: string | undefined): boolean {
  try {
    const models = readDefaultModels();
    const next =
      model === undefined
        ? Object.fromEntries(Object.entries(models).filter(([key]) => key !== harness))
        : { ...models, [harness]: model.trim() };
    localStorage.setItem(DEFAULT_MODELS_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** A configured but unavailable default deliberately clears remembered model overrides. */
export function availableDefaultModel(
  configured: string | null | undefined,
  options: readonly { id: string }[],
): string | undefined {
  if (configured == null) return undefined;
  return options.some((option) => option.id === configured) ? configured : "";
}
