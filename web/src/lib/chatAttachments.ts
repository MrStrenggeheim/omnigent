export interface ChatAttachmentContent {
  type?: string;
  file_id?: string;
  filename?: string;
  image_url?: string;
  file_data?: string;
  error?: string;
}
/** Imported transcript blocks may contain non-string attachment fields. */
export function normalizeAttachmentContent(value: unknown): ChatAttachmentContent {
  if (!value || typeof value !== "object") return {};
  const block = value as Record<string, unknown>;
  return Object.fromEntries(
    ["type", "file_id", "filename", "image_url", "file_data", "error"]
      .filter((key) => typeof block[key] === "string")
      .map((key) => [key, block[key]]),
  ) as ChatAttachmentContent;
}

export function attachmentsFromContent(content: unknown[]): ChatAttachmentContent[] {
  return content
    .map(normalizeAttachmentContent)
    .filter((block) =>
      [block.file_id, block.image_url, block.file_data, block.error].some(
        (value) => typeof value === "string",
      ),
    );
}
